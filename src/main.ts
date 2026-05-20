import { createEditor } from '@rhwp/editor';
import type { RhwpEditor } from '@rhwp/editor';
import initRhwpCore from '@rhwp/core';
import rhwpWasmUrl from '@rhwp/core/rhwp_bg.wasm?url';
import { mergeHwpTemplate } from './hwpMerge';
import './styles.css';

declare global {
  interface Window {
    __hwpAutomationTest?: {
      loadFile(bytes: number[], fileName: string): Promise<void>;
      loadHwpx(bytes: number[]): Promise<void>;
      setColumnNames(names: string[]): void;
      setRows(rows: string[][]): void;
      runBatch(): Promise<void>;
      exportHwpx(): Promise<number[]>;
      status(): string;
    };
  }
}

const initialRows = 4;
const initialColumns = ['이름', '소속', '날짜'];

let columnNames = [...initialColumns];
let tableData: string[][] = Array.from({ length: initialRows }, () =>
  Array.from({ length: initialColumns.length }, () => ''),
);
let rhwpCoreReady: Promise<void> | null = null;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-shell">
    <main class="workspace">
      <section class="editor-stage" aria-label="HWP 편집기">
        <div id="editor" class="editor-host">
          <div class="editor-loading">rhwp 편집기를 불러오는 중입니다.</div>
        </div>
      </section>
    </main>

    <aside class="automation-sidebar" aria-label="자동화 사이드바">
      <div class="sidebar-header">
        <div>
          <p class="eyebrow">Automation Panel</p>
          <h1>한글 문서 자동 채우기</h1>
        </div>
        <button id="manual-button" class="button button-primary" type="button">사용설명서</button>
      </div>

      <section class="table-panel">
        <div class="panel-toolbar">
          <div>
            <h2>작업 표</h2>
            <p>열 이름이 문서 안의 $열이름 치환 키가 됩니다.</p>
          </div>
          <div class="table-actions" aria-label="표 확장">
            <button id="add-row" class="icon-button" type="button" title="행 추가">+행</button>
            <button id="add-col" class="icon-button" type="button" title="열 추가">+열</button>
          </div>
        </div>
        <div class="table-wrap">
          <table id="automation-table"></table>
        </div>
        <div class="batch-panel">
          <button id="batch-button" class="button button-primary" type="button">일괄 처리</button>
          <button id="download-button" class="button button-secondary" type="button" disabled>결과 HWP 다운로드</button>
          <p id="batch-status" class="batch-status" role="status">양식의 $이름, $소속, $날짜 같은 값을 표 데이터로 바꿉니다.</p>
        </div>
      </section>
    </aside>
  </div>

  <div id="manual-modal" class="modal-backdrop" hidden>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="manual-title">
      <header class="modal-header">
        <h2 id="manual-title">사용설명서</h2>
        <button id="manual-close" class="close-button" type="button" aria-label="닫기">×</button>
      </header>
      <div class="modal-body">
        <p>이 화면은 HWP 문서를 열고, 오른쪽 자동화 표에서 필요한 입력값을 관리하는 기본 작업 공간입니다.</p>
        <ol>
          <li>좌측 rhwp 편집기에서 HWP 또는 HWPX 파일을 엽니다.</li>
          <li>표의 열 이름을 이름, 소속, 날짜처럼 치환 키로 바꿉니다.</li>
          <li>각 행에 한 페이지씩 생성할 데이터를 입력합니다.</li>
          <li>일괄 처리를 누르면 양식을 행 수만큼 복제하고 $열이름 값을 치환합니다.</li>
        </ol>
      </div>
    </section>
  </div>
`;

const table = document.querySelector<HTMLTableElement>('#automation-table')!;
const editorHost = document.querySelector<HTMLDivElement>('#editor')!;
const addRowButton = document.querySelector<HTMLButtonElement>('#add-row')!;
const addColButton = document.querySelector<HTMLButtonElement>('#add-col')!;
const batchButton = document.querySelector<HTMLButtonElement>('#batch-button')!;
const downloadButton = document.querySelector<HTMLButtonElement>('#download-button')!;
const batchStatus = document.querySelector<HTMLParagraphElement>('#batch-status')!;
const manualButton = document.querySelector<HTMLButtonElement>('#manual-button')!;
const manualModal = document.querySelector<HTMLDivElement>('#manual-modal')!;
const manualCloseButton = document.querySelector<HTMLButtonElement>('#manual-close')!;
let lastMergedBytes: Uint8Array | null = null;

function escapeAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderTable() {
  table.innerHTML = `
    <thead>
      <tr>
        ${columnNames
          .map(
            (name, index) => `
              <th scope="col">
                <input
                  aria-label="${index + 1}열 이름"
                  class="column-name-input"
                  data-column-name="${index}"
                  value="${escapeAttribute(name)}"
                />
              </th>
            `,
          )
          .join('')}
      </tr>
    </thead>
    <tbody>
      ${tableData
        .map(
          (row, rowIndex) => `
            <tr>
              ${row
                .map(
                  (cell, colIndex) => `
                    <td>
                      <input
                        aria-label="${rowIndex + 1}행 ${columnNames[colIndex]}"
                        class="cell-input"
                        data-row="${rowIndex}"
                        data-col="${colIndex}"
                        value="${escapeAttribute(cell)}"
                      />
                    </td>
                  `,
                )
                .join('')}
            </tr>
          `,
        )
        .join('')}
    </tbody>
  `;
}

renderTable();

table.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.dataset.columnName != null) {
    const col = Number(target.dataset.columnName);
    columnNames[col] = target.value;
    updateBatchHint();
    return;
  }

  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);
  tableData[row][col] = target.value;
});

addRowButton.addEventListener('click', () => {
  tableData = [...tableData, Array.from({ length: tableData[0].length }, () => '')];
  renderTable();
});

addColButton.addEventListener('click', () => {
  columnNames = [...columnNames, `항목${columnNames.length + 1}`];
  tableData = tableData.map((row) => [...row, '']);
  renderTable();
  updateBatchHint();
});

function updateBatchHint() {
  const placeholders = columnNames
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((name) => `$${name}`)
    .join(', ');

  batchStatus.textContent = placeholders
    ? `양식의 ${placeholders} 값을 표 데이터로 바꿉니다.`
    : '열 이름을 입력하면 $열이름 치환 키로 사용됩니다.';
}

function setBatchStatus(message: string, state: 'idle' | 'working' | 'success' | 'error' = 'idle') {
  batchStatus.textContent = message;
  batchStatus.dataset.state = state;
}

manualButton.addEventListener('click', () => {
  manualModal.hidden = false;
});

manualCloseButton.addEventListener('click', () => {
  manualModal.hidden = true;
});

manualModal.addEventListener('click', (event) => {
  if (event.target === manualModal) {
    manualModal.hidden = true;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    manualModal.hidden = true;
  }
});

editorHost.innerHTML = '';
const editorPromise = createEditor(editorHost, {
  width: '100%',
  height: '100%',
});

batchButton.addEventListener('click', () => {
  void runBatch();
});

async function runBatch() {
  const rows = tableData.filter((row) => row.some((cell) => cell.trim() !== ''));
  const keys = columnNames.map((name) => name.trim());
  lastMergedBytes = null;
  downloadButton.disabled = true;

  if (rows.length === 0) {
    setBatchStatus('처리할 데이터 행을 하나 이상 입력해주세요.', 'error');
    return;
  }

  if (keys.some((key) => key === '')) {
    setBatchStatus('비어 있는 열 이름을 먼저 채워주세요.', 'error');
    return;
  }

  const duplicateKey = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicateKey) {
    setBatchStatus(`중복된 열 이름 "${duplicateKey}"을 하나만 남겨주세요.`, 'error');
    return;
  }

  batchButton.disabled = true;
  setBatchStatus('편집기를 확인하고 현재 양식을 HWP로 내보내는 중입니다.', 'working');

  try {
    const activeEditor = await getEditor();
    await ensureRhwpCore();
    const templateBytes = await activeEditor.exportHwp();
    const records = rows.map((row) =>
      Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ''])),
    );
    const mergedBytes = mergeHwpTemplate(templateBytes, records);
    lastMergedBytes = mergedBytes;
    downloadButton.disabled = false;
    setBatchStatus('결과 HWP를 생성했습니다. rhwp에 다시 여는 중입니다.', 'working');

    const loadState = await loadResultIntoEditor(mergedBytes, 'hwp-automation-merged.hwp');
    if (loadState === 'loaded') {
      setBatchStatus(`${records.length}건을 양식에 반영했습니다.`, 'success');
    } else {
      setBatchStatus(
        `${records.length}건 결과 HWP를 생성했지만 rhwp 미리보기 응답이 늦습니다. 다운로드 파일은 생성되어 있습니다.`,
        'error',
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '일괄 처리 중 오류가 발생했습니다.';
    setBatchStatus(normalizeBatchError(message), 'error');
  } finally {
    batchButton.disabled = false;
  }
}

async function ensureRhwpCore() {
  if (!rhwpCoreReady) {
    installMeasureTextWidth();
    rhwpCoreReady = initRhwpCore(rhwpWasmUrl).then(() => undefined);
  }

  await rhwpCoreReady;
}

function installMeasureTextWidth() {
  const runtime = globalThis as typeof globalThis & {
    measureTextWidth?: (font: string, text: string) => number;
  };

  if (runtime.measureTextWidth) return;

  let context: CanvasRenderingContext2D | null = null;
  let lastFont = '';

  runtime.measureTextWidth = (font, text) => {
    context ??= document.createElement('canvas').getContext('2d');
    if (!context) return text.length * 10;

    if (font !== lastFont) {
      context.font = font;
      lastFont = font;
    }

    return context.measureText(text).width;
  };
}

async function loadResultIntoEditor(bytes: Uint8Array, fileName: string) {
  const activeEditor = await getEditor();
  const loadPromise = loadFileForAutomation(activeEditor, bytes, fileName).then(() => 'loaded' as const);
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    window.setTimeout(() => resolve('timeout'), 8_000);
  });

  return Promise.race([loadPromise, timeoutPromise]);
}

async function loadFileForAutomation(editor: RhwpEditor, bytes: Uint8Array, fileName: string) {
  const requestableEditor = editor as RhwpEditor & {
    _request?: (
      method: string,
      params?: Record<string, unknown>,
    ) => Promise<unknown>;
  };

  if (requestableEditor._request) {
    return requestableEditor._request('loadFile', {
      data: Array.from(bytes),
      fileName,
      skipUnsavedGuard: true,
      skipValidationModal: true,
      autoFixValidation: true,
      skipHwpxSaveModeToast: true,
    });
  }

  return editor.loadFile(bytes, fileName);
}

async function getEditor() {
  return editorPromise;
}

downloadButton.addEventListener('click', () => {
  if (!lastMergedBytes) return;

  const buffer = new ArrayBuffer(lastMergedBytes.byteLength);
  new Uint8Array(buffer).set(lastMergedBytes);
  const blob = new Blob([buffer], { type: 'application/x-hwp' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'hwp-automation-merged.hwp';
  link.click();
  URL.revokeObjectURL(url);
});

function normalizeBatchError(message: string) {
  if (message.includes('문서가 로드되지 않았습니다')) {
    return '좌측 rhwp에서 양식 파일을 먼저 열어주세요.';
  }

  if (message.includes('Request timeout')) {
    return 'rhwp 응답 시간이 초과되었습니다. 양식 로드 상태를 확인한 뒤 다시 시도해주세요.';
  }

  return message;
}

if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
  window.__hwpAutomationTest = {
    async loadFile(bytes: number[], fileName: string) {
      const activeEditor = await getEditor();
      await loadFileForAutomation(activeEditor, new Uint8Array(bytes), fileName);
      setBatchStatus('테스트 양식을 로드했습니다.', 'idle');
    },
    async loadHwpx(bytes: number[]) {
      await this.loadFile(bytes, 'automation-test-template.hwpx');
    },
    setColumnNames(names: string[]) {
      columnNames = [...names];
      tableData = tableData.map((row) => names.map((_, index) => row[index] ?? ''));
      renderTable();
      updateBatchHint();
    },
    setRows(rows: string[][]) {
      tableData = rows.map((row) => columnNames.map((_, index) => row[index] ?? ''));
      renderTable();
    },
    async runBatch() {
      await runBatch();
    },
    async exportHwpx() {
      const activeEditor = await getEditor();
      const bytes = lastMergedBytes ?? (await activeEditor.exportHwpx());
      return Array.from(bytes);
    },
    status() {
      return batchStatus.textContent ?? '';
    },
  };
}
