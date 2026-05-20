import { HwpDocument } from '@rhwp/core';

interface HwpSearchHit {
  sec: number;
  para: number;
  charOffset: number;
  length: number;
  cellContext?: {
    parentPara: number;
    ctrlIdx: number;
    cellIdx: number;
    cellPara: number;
  };
}

interface ParagraphRange {
  start: number;
  end: number;
}

interface TemplatePageBreak {
  beforeParaOffset: number;
}

export function mergeHwpTemplate(
  templateBytes: Uint8Array,
  records: Array<Record<string, string>>,
) {
  if (records.length === 0) return templateBytes;

  const document = new HwpDocument(templateBytes);
  document.convertToEditable();

  const templateParaCount = document.getParagraphCount(0);
  const templatePageBreaks = getTemplatePageBreaks(document, templateParaCount);
  duplicateTemplatePages(document, records.length, templateParaCount);

  for (const [recordIndex, record] of records.entries()) {
    const range = {
      start: recordIndex * templateParaCount,
      end: (recordIndex + 1) * templateParaCount,
    };
    replaceRecordPlaceholders(document, record, range);
  }

  restoreInternalPageBreaks(document, records.length, templateParaCount, templatePageBreaks);

  return document.exportHwp();
}

function getTemplatePageBreaks(
  document: HwpDocument,
  templateParaCount: number,
): TemplatePageBreak[] {
  const breaks: TemplatePageBreak[] = [];
  let previousPage = getParagraphPage(document, 0);

  for (let para = 1; para < templateParaCount; para += 1) {
    const page = getParagraphPage(document, para);
    if (page > previousPage) {
      breaks.push({ beforeParaOffset: para });
    }
    previousPage = page;
  }

  return breaks;
}

function restoreInternalPageBreaks(
  document: HwpDocument,
  copyCount: number,
  templateParaCount: number,
  pageBreaks: TemplatePageBreak[],
) {
  if (copyCount <= 1 || pageBreaks.length === 0) return;

  for (let copyIndex = copyCount - 1; copyIndex >= 1; copyIndex -= 1) {
    for (let breakIndex = pageBreaks.length - 1; breakIndex >= 0; breakIndex -= 1) {
      const { beforeParaOffset } = pageBreaks[breakIndex];
      if (beforeParaOffset <= 0) continue;

      const previousPara = copyIndex * templateParaCount + beforeParaOffset - 1;
      const nextPara = previousPara + 1;
      if (
        nextPara >= document.getParagraphCount(0) ||
        getParagraphPage(document, nextPara) > getParagraphPage(document, previousPara)
      ) {
        continue;
      }

      const previousOffset = document.getParagraphLength(0, previousPara);
      const breakResult = JSON.parse(
        document.insertPageBreak(0, previousPara, previousOffset),
      ) as { ok?: boolean; error?: string };

      if (!breakResult.ok) {
        throw new Error(breakResult.error ?? '복사본 페이지 나눔 복원에 실패했습니다.');
      }
    }
  }
}

function getParagraphPage(document: HwpDocument, para: number) {
  const result = JSON.parse(document.getPageOfPosition(0, para)) as {
    page?: number;
    error?: string;
  };

  if (typeof result.page !== 'number') {
    throw new Error(result.error ?? '문단의 페이지 위치를 확인하지 못했습니다.');
  }

  return result.page;
}

function duplicateTemplatePages(
  document: HwpDocument,
  copyCount: number,
  templateParaCount: number,
) {
  if (copyCount <= 1) return;

  const templateEndPara = templateParaCount - 1;
  const templateEndOffset = document.getParagraphLength(0, templateEndPara);
  const copyResult = JSON.parse(
    document.copySelection(0, 0, 0, templateEndPara, templateEndOffset),
  ) as { ok?: boolean; error?: string };

  if (!copyResult.ok) {
    throw new Error(copyResult.error ?? '양식 복사에 실패했습니다.');
  }

  for (let index = 1; index < copyCount; index += 1) {
    const lastPara = document.getParagraphCount(0) - 1;
    const lastOffset = document.getParagraphLength(0, lastPara);
    const breakResult = JSON.parse(document.insertPageBreak(0, lastPara, lastOffset)) as {
      ok?: boolean;
      paraIdx?: number;
      charOffset?: number;
      error?: string;
    };

    if (!breakResult.ok || breakResult.paraIdx == null || breakResult.charOffset == null) {
      throw new Error(breakResult.error ?? '페이지 추가에 실패했습니다.');
    }

    const pasteResult = JSON.parse(
      document.pasteInternal(0, breakResult.paraIdx, breakResult.charOffset),
    ) as { ok?: boolean; error?: string };

    if (!pasteResult.ok) {
      throw new Error(pasteResult.error ?? '양식 붙여넣기에 실패했습니다.');
    }
  }
}

function replaceRecordPlaceholders(
  document: HwpDocument,
  record: Record<string, string>,
  range: ParagraphRange,
) {
  const replacements = Object.entries(record)
    .map(([key, value]) => ({ placeholder: `$${key}`, value }))
    .filter(({ placeholder }) => placeholder.length > 1)
    .sort((a, b) => b.placeholder.length - a.placeholder.length);

  for (const { placeholder, value } of replacements) {
    const hits = findHitsInRange(document, placeholder, range);
    for (const hit of hits) {
      replaceHit(document, hit, value);
    }
  }
}

function findHitsInRange(document: HwpDocument, placeholder: string, range: ParagraphRange) {
  const hits = JSON.parse(document.searchAllText(placeholder, false, true)) as HwpSearchHit[];

  return hits
    .filter((hit) => hit.sec === 0 && hit.para >= range.start && hit.para < range.end)
    .sort((a, b) => {
      if (a.para !== b.para) return b.para - a.para;
      const aCellPara = a.cellContext?.cellPara ?? -1;
      const bCellPara = b.cellContext?.cellPara ?? -1;
      if (aCellPara !== bCellPara) return bCellPara - aCellPara;
      return b.charOffset - a.charOffset;
    });
}

function replaceHit(document: HwpDocument, hit: HwpSearchHit, value: string) {
  if (hit.cellContext) {
    const { parentPara, ctrlIdx, cellIdx, cellPara } = hit.cellContext;
    document.deleteTextInCell(0, parentPara, ctrlIdx, cellIdx, cellPara, hit.charOffset, hit.length);
    document.insertTextInCell(0, parentPara, ctrlIdx, cellIdx, cellPara, hit.charOffset, value);
    return;
  }

  document.replaceText(hit.sec, hit.para, hit.charOffset, hit.length, value);
}
