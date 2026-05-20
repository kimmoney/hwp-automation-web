import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import init, { HwpDocument } from '@rhwp/core';
import { mergeHwpTemplate } from '../src/hwpMerge';

const wasm = readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm');
await init({ module_or_path: wasm });

const template = createTwoPageTemplateDocument();

const mergedBytes = mergeHwpTemplate(template.exportHwp(), [
  { 이름: '김철수', 소속: '개발팀', 날짜: '2026-05-20' },
  { 이름: '이영희', 소속: '영업팀', 날짜: '2026-05-21' },
]);

const merged = new HwpDocument(mergedBytes);

assert.equal(template.pageCount(), 2);
assert.equal(merged.pageCount(), 4);
assert.equal(readValidationWarningCount(merged), 0);
assertSearches(merged, '김철수');
assertSearches(merged, '개발팀');
assertSearches(merged, '2026-05-20');
assertSearches(merged, '이영희');
assertSearches(merged, '영업팀');
assertSearches(merged, '2026-05-21');
assertDoesNotSearch(merged, '$이름');
assertDoesNotSearch(merged, '$소속');
assertDoesNotSearch(merged, '$날짜');

console.log('rhwp end-to-end test passed');

function createTwoPageTemplateDocument() {
  const template = HwpDocument.createEmpty();
  template.createBlankDocument();
  template.insertText(0, 0, 0, '성명: $이름\n소속: $소속');
  template.insertPageBreak(0, 0, template.getParagraphLength(0, 0));
  template.insertText(0, 1, 0, '일자: $날짜');
  return template;
}

function readValidationWarningCount(doc: HwpDocument) {
  const warnings = JSON.parse(doc.getValidationWarnings()) as { count?: number };
  return warnings.count ?? 0;
}

function assertSearches(doc: HwpDocument, query: string) {
  const hits = JSON.parse(doc.searchAllText(query, false, true)) as unknown[];
  assert.ok(hits.length > 0, `${query} should be found`);
}

function assertDoesNotSearch(doc: HwpDocument, query: string) {
  const hits = JSON.parse(doc.searchAllText(query, false, true)) as unknown[];
  assert.equal(hits.length, 0, `${query} should be fully replaced`);
}
