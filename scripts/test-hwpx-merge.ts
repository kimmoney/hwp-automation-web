import assert from 'node:assert/strict';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { mergeHwpxTemplate, restorePageDefInSectionXml } from '../src/hwpxMerge';

const sectionXml = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="1" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run><hp:t>성명: $이름</hp:t></hp:run>
    <hp:run><hp:t>소속: $소속</hp:t></hp:run>
    <hp:run><hp:t>분리: $</hp:t></hp:run><hp:run><hp:t>날</hp:t></hp:run><hp:run><hp:t>짜</hp:t></hp:run>
  </hp:p>
</hs:sec>`;

const secondSectionXml = `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p id="2" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    <hp:run><hp:t>확인자: $이름</hp:t></hp:run>
  </hp:p>
</hs:sec>`;

const template = zipSync({
  'Contents/section0.xml': strToU8(sectionXml),
  'Contents/section1.xml': strToU8(secondSectionXml),
  'Preview/PrvText.txt': strToU8('성명: $이름\n소속: $소속'),
});

const merged = mergeHwpxTemplate(template, [
  { 이름: '김철수', 소속: '개발팀', 날짜: '2026-05-20' },
  { 이름: '이영희', 소속: '영업팀 & 지원', 날짜: '2026-05-21' },
]);

const files = unzipSync(merged);
const mergedXml = strFromU8(files['Contents/section0.xml']);
const mergedSecondSectionXml = strFromU8(files['Contents/section1.xml']);
const previewText = strFromU8(files['Preview/PrvText.txt']);

assert.match(mergedXml, /성명: 김철수/);
assert.match(mergedXml, /소속: 개발팀/);
assert.match(mergedXml, /분리: 2026-05-20/);
assert.match(mergedXml, /성명: 이영희/);
assert.match(mergedXml, /소속: 영업팀 &amp; 지원/);
assert.match(mergedXml, /분리: 2026-05-21/);
assert.equal((mergedXml.match(/<hp:p/g) ?? []).length, 2);
assert.match(mergedXml, /pageBreak="1"/);
assert.match(mergedSecondSectionXml, /확인자: 김철수/);
assert.match(mergedSecondSectionXml, /확인자: 이영희/);
assert.equal((mergedSecondSectionXml.match(/<hp:p/g) ?? []).length, 2);
assert.match(previewText, /1\. 이름: 김철수, 소속: 개발팀, 날짜: 2026-05-20/);
assert.match(previewText, /2\. 이름: 이영희, 소속: 영업팀 & 지원, 날짜: 2026-05-21/);

const restoredPageXml = restorePageDefInSectionXml(
  '<hp:pagePr landscape="WIDELY" width="59528" height="84186"><hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/></hp:pagePr>',
  {
    width: 59528,
    height: 84188,
    marginLeft: 4251,
    marginRight: 4251,
    marginTop: 1417,
    marginBottom: 1417,
    marginHeader: 4251,
    marginFooter: 4251,
    marginGutter: 0,
  },
);

assert.match(restoredPageXml, /width="59528"/);
assert.match(restoredPageXml, /height="84188"/);
assert.match(restoredPageXml, /left="4251"/);
assert.match(restoredPageXml, /right="4251"/);
assert.match(restoredPageXml, /top="1417"/);
assert.match(restoredPageXml, /bottom="1417"/);

console.log('HWPX merge test passed');
