import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export function mergeHwpxTemplate(
  templateBytes: Uint8Array,
  records: Array<Record<string, string>>,
  options: MergeHwpxTemplateOptions = {},
) {
  const files = unzipSync(templateBytes);
  const sectionPaths = findSectionPaths(files);

  for (const sectionPath of sectionPaths) {
    const sectionXml = strFromU8(files[sectionPath]);
    const mergedSectionXml = buildMergedSectionXml(sectionXml, records);
    files[sectionPath] = strToU8(mergedSectionXml);
  }

  updatePreviewText(files, records);
  restoreSectionPageDefs(files, options.pageDefs ?? []);

  return zipSync(files, { level: 6 });
}

export interface HwpxPageDef {
  width?: number;
  height?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
  marginHeader?: number;
  marginFooter?: number;
  marginGutter?: number;
}

export interface MergeHwpxTemplateOptions {
  pageDefs?: HwpxPageDef[];
}

export function findSectionPaths(files: Record<string, Uint8Array>) {
  const sectionPaths = Object.keys(files)
    .filter((path) => /^Contents\/section\d+\.xml$/i.test(path))
    .sort((a, b) => sectionNumber(a) - sectionNumber(b));

  if (sectionPaths.length === 0) {
    throw new Error('HWPX 본문 파일(Contents/section0.xml)을 찾지 못했습니다.');
  }

  return sectionPaths;
}

function sectionNumber(path: string) {
  return Number(path.match(/section(\d+)\.xml$/i)?.[1] ?? 0);
}

export function buildMergedSectionXml(sectionXml: string, records: Array<Record<string, string>>) {
  const sectionMatch = sectionXml.match(/<hs:sec\b[^>]*>([\s\S]*)<\/hs:sec>/);

  if (!sectionMatch || sectionMatch.index == null) {
    throw new Error('HWPX 본문 구조를 해석하지 못했습니다.');
  }

  const openTagEnd = sectionMatch.index + sectionMatch[0].indexOf('>') + 1;
  const closeTagStart = sectionMatch.index + sectionMatch[0].lastIndexOf('</hs:sec>');
  const prefix = sectionXml.slice(0, openTagEnd);
  const body = sectionXml.slice(openTagEnd, closeTagStart);
  const suffix = sectionXml.slice(closeTagStart);

  const mergedBodies = records.map((record, index) =>
    markFirstParagraphPageBreak(replacePlaceholdersInXml(body, record), index > 0),
  );

  return `${prefix}${mergedBodies.join('')}${suffix}`;
}

export function replacePlaceholdersInXml(xml: string, record: Record<string, string>) {
  const replacements = Object.entries(record)
    .map(([key, value]) => ({ placeholder: `$${key}`, value }))
    .filter(({ placeholder }) => placeholder.length > 1)
    .sort((a, b) => b.placeholder.length - a.placeholder.length);

  if (replacements.length === 0) return xml;

  const textNodes = collectTextNodes(xml);

  if (textNodes.length === 0) {
    return replacements.reduce(
      (result, { placeholder, value }) => result.replaceAll(placeholder, escapeXmlText(value)),
      xml,
    );
  }

  const fullText = textNodes.map((node) => node.text).join('');
  const matches = findPlaceholderMatches(fullText, replacements);

  if (matches.length === 0) return xml;

  for (const match of matches.sort((a, b) => b.start - a.start)) {
    applyTextReplacement(textNodes, match.start, match.end, match.value);
  }

  let output = '';
  let cursor = 0;

  for (const node of textNodes) {
    output += xml.slice(cursor, node.contentStart);
    output += escapeXmlText(node.text);
    cursor = node.contentEnd;
  }

  return output + xml.slice(cursor);
}

export function escapeXmlText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function decodeXmlText(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    switch (code.toLowerCase()) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        if (code.toLowerCase().startsWith('#x')) {
          return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
        }

        if (code.startsWith('#')) {
          return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
        }

        return entity;
    }
  });
}

interface TextNodeSlice {
  contentStart: number;
  contentEnd: number;
  start: number;
  end: number;
  text: string;
}

interface PlaceholderReplacement {
  placeholder: string;
  value: string;
}

interface PlaceholderMatch {
  start: number;
  end: number;
  value: string;
}

function collectTextNodes(xml: string) {
  const nodes: TextNodeSlice[] = [];
  const textNodePattern = /<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g;
  let textOffset = 0;
  let match: RegExpExecArray | null;

  while ((match = textNodePattern.exec(xml)) != null) {
    const rawText = match[1];
    const contentStart = match.index + match[0].indexOf('>') + 1;
    const contentEnd = contentStart + rawText.length;
    const text = decodeXmlText(rawText);

    nodes.push({
      contentStart,
      contentEnd,
      start: textOffset,
      end: textOffset + text.length,
      text,
    });

    textOffset += text.length;
  }

  return nodes;
}

function findPlaceholderMatches(
  fullText: string,
  replacements: PlaceholderReplacement[],
): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  const occupied = Array.from({ length: fullText.length }, () => false);

  for (let index = 0; index < fullText.length; index += 1) {
    const replacement = replacements.find(({ placeholder }) => {
      if (!fullText.startsWith(placeholder, index)) return false;
      return !occupied.slice(index, index + placeholder.length).some(Boolean);
    });

    if (!replacement) continue;

    for (let occupiedIndex = index; occupiedIndex < index + replacement.placeholder.length; occupiedIndex += 1) {
      occupied[occupiedIndex] = true;
    }

    matches.push({
      start: index,
      end: index + replacement.placeholder.length,
      value: replacement.value,
    });

    index += replacement.placeholder.length - 1;
  }

  return matches;
}

function applyTextReplacement(
  nodes: TextNodeSlice[],
  start: number,
  end: number,
  value: string,
) {
  const touchedNodes = nodes.filter((node) => node.end > start && node.start < end);

  for (const [index, node] of touchedNodes.entries()) {
    const localStart = Math.max(start, node.start) - node.start;
    const localEnd = Math.min(end, node.end) - node.start;
    const insertedValue = index === 0 ? value : '';

    node.text = `${node.text.slice(0, localStart)}${insertedValue}${node.text.slice(localEnd)}`;
  }
}

export function markFirstParagraphPageBreak(xml: string, shouldBreak: boolean) {
  if (!shouldBreak) return xml;

  return xml.replace(/<hp:p\b([^>]*)>/, (match, attributes: string) => {
    if (/pageBreak=/.test(attributes)) {
      return `<hp:p${attributes.replace(/pageBreak="[^"]*"/, 'pageBreak="1"')}>`;
    }

    return `<hp:p${attributes} pageBreak="1">`;
  });
}

function updatePreviewText(files: Record<string, Uint8Array>, records: Array<Record<string, string>>) {
  if (!files['Preview/PrvText.txt']) return;

  const preview = records
    .map((record, index) => {
      const values = Object.entries(record)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      return `${index + 1}. ${values}`;
    })
    .join('\n');

  files['Preview/PrvText.txt'] = strToU8(preview);
}

function restoreSectionPageDefs(files: Record<string, Uint8Array>, pageDefs: HwpxPageDef[]) {
  if (pageDefs.length === 0) return;

  for (const sectionPath of findSectionPaths(files)) {
    const sectionIdx = sectionNumber(sectionPath);
    const pageDef = pageDefs[sectionIdx] ?? pageDefs.at(-1);
    if (!pageDef) continue;

    const sectionXml = strFromU8(files[sectionPath]);
    const restoredXml = restorePageDefInSectionXml(sectionXml, pageDef);
    files[sectionPath] = strToU8(restoredXml);
  }
}

export function restorePageDefInSectionXml(sectionXml: string, pageDef: HwpxPageDef) {
  return sectionXml.replace(
    /<hp:pagePr\b([^>]*)>([\s\S]*?)<hp:margin\b([^>]*)\/>([\s\S]*?)<\/hp:pagePr>/,
    (_match, pagePrAttrs: string, beforeMargin: string, marginAttrs: string, afterMargin: string) => {
      let nextPagePrAttrs = pagePrAttrs;
      if (typeof pageDef.width === 'number') {
        nextPagePrAttrs = setXmlAttribute(nextPagePrAttrs, 'width', String(pageDef.width));
      }
      if (typeof pageDef.height === 'number') {
        nextPagePrAttrs = setXmlAttribute(nextPagePrAttrs, 'height', String(pageDef.height));
      }

      let nextMarginAttrs = marginAttrs;
      nextMarginAttrs = setNumberAttribute(nextMarginAttrs, 'left', pageDef.marginLeft);
      nextMarginAttrs = setNumberAttribute(nextMarginAttrs, 'right', pageDef.marginRight);
      nextMarginAttrs = setNumberAttribute(nextMarginAttrs, 'top', pageDef.marginTop);
      nextMarginAttrs = setNumberAttribute(nextMarginAttrs, 'bottom', pageDef.marginBottom);
      nextMarginAttrs = setNumberAttribute(nextMarginAttrs, 'header', pageDef.marginHeader);
      nextMarginAttrs = setNumberAttribute(nextMarginAttrs, 'footer', pageDef.marginFooter);
      nextMarginAttrs = setNumberAttribute(nextMarginAttrs, 'gutter', pageDef.marginGutter);

      return `<hp:pagePr${nextPagePrAttrs}>${beforeMargin}<hp:margin${nextMarginAttrs}/>${afterMargin}</hp:pagePr>`;
    },
  );
}

function setNumberAttribute(attributes: string, name: string, value: number | undefined) {
  if (typeof value !== 'number') return attributes;
  return setXmlAttribute(attributes, name, String(value));
}

function setXmlAttribute(attributes: string, name: string, value: string) {
  const escapedValue = escapeAttributeValue(value);
  const attributePattern = new RegExp(`\\b${name}="[^"]*"`);

  if (attributePattern.test(attributes)) {
    return attributes.replace(attributePattern, `${name}="${escapedValue}"`);
  }

  return `${attributes} ${name}="${escapedValue}"`;
}

function escapeAttributeValue(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
