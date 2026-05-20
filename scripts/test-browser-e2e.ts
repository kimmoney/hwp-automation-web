import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import init, { HwpDocument } from '@rhwp/core';
import { chromium } from 'playwright';

const port = 5174;
const url = `http://127.0.0.1:${port}/`;
const vite = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

try {
  await waitForServer(url);

  const wasm = readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm');
  await init({ module_or_path: wasm });

  const template = createTemplateDocument();
  const expectedPageCount = template.pageCount() * 2;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__hwpAutomationTest != null, undefined, {
      timeout: 60_000,
    });

    await runBrowserBatch(
      page,
      Array.from(template.exportHwpx()),
      'automation-test-template.hwpx',
      expectedPageCount,
    );
    await runBrowserBatch(
      page,
      Array.from(template.exportHwp()),
      'automation-test-template.hwp',
      expectedPageCount,
    );
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log('browser end-to-end test passed');
} finally {
  vite.kill('SIGTERM');
}

async function waitForServer(targetUrl: string) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 30_000) {
    if (vite.exitCode != null) {
      throw new Error(`Vite exited early with code ${vite.exitCode}`);
    }

    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${targetUrl}: ${String(lastError)}`);
}

function assertSearches(doc: HwpDocument, query: string) {
  const hits = JSON.parse(doc.searchAllText(query, false, true)) as unknown[];
  assert.ok(hits.length > 0, `${query} should be found`);
}

function assertDoesNotSearch(doc: HwpDocument, query: string) {
  const hits = JSON.parse(doc.searchAllText(query, false, true)) as unknown[];
  assert.equal(hits.length, 0, `${query} should be fully replaced`);
}

function readValidationWarningCount(doc: HwpDocument) {
  const warnings = JSON.parse(doc.getValidationWarnings()) as { count?: number };
  return warnings.count ?? 0;
}

function createTemplateDocument() {
  const template = HwpDocument.createEmpty();
  template.createBlankDocument();
  template.insertText(0, 0, 0, '성명: $이름\n소속: $소속');
  template.insertPageBreak(0, 0, template.getParagraphLength(0, 0));
  template.insertText(0, 1, 0, '일자: $날짜');
  return template;
}

async function runBrowserBatch(
  page: import('playwright').Page,
  bytes: number[],
  fileName: string,
  expectedPageCount: number,
) {
  await page.evaluate(async ({ data, name }) => {
    await window.__hwpAutomationTest!.loadFile(data, name);
  }, { data: bytes, name: fileName });

  await page.evaluate(() => {
    window.__hwpAutomationTest!.setColumnNames(['이름', '소속', '날짜']);
    window.__hwpAutomationTest!.setRows([
      ['김철수', '개발팀', '2026-05-20'],
      ['이영희', '영업팀', '2026-05-21'],
    ]);
  });

  await page.evaluate(async () => {
    await window.__hwpAutomationTest!.runBatch();
  });

  const status = await page.evaluate(() => window.__hwpAutomationTest!.status());
  assert.match(status, /2건을 양식에 반영했습니다/);

  const mergedBytes = await page.evaluate(async () => window.__hwpAutomationTest!.exportHwpx());
  const merged = new HwpDocument(new Uint8Array(mergedBytes));

  assert.equal(merged.pageCount(), expectedPageCount);
  assert.equal(readValidationWarningCount(merged), 0);
  assertSearches(merged, '김철수');
  assertSearches(merged, '이영희');
  assertDoesNotSearch(merged, '$이름');
}
