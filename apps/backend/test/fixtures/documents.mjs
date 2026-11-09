import { zipEntries } from './docx.ts';

const TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = 'http://schemas.openxmlformats.org';
const relationships = (entries) => `<Relationships xmlns="${RELS}">${entries}</Relationships>`;
const relationship = (id, type, target) =>
  `<Relationship Id="${id}" Type="${OFFICE}/${type}" Target="${target}"/>`;
export const documentText = 'Flux Україна café Ελληνικά';

export function officeEntries(source) {
  const path =
    source === 'docx'
      ? 'word/document.xml'
      : source === 'xlsx'
        ? 'xl/workbook.xml'
        : 'ppt/presentation.xml';
  const type =
    source === 'docx'
      ? 'wordprocessingml.document'
      : source === 'xlsx'
        ? 'spreadsheetml.sheet'
        : 'presentationml.presentation';
  const entries = {
    '[Content_Types].xml': `<Types xmlns="${TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`,
    '_rels/.rels': relationships(relationship('rId1', 'officeDocument', path)),
    'docProps/core.xml':
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>',
  };
  entries['_rels/.rels'] = entries['_rels/.rels'].replace(
    '</Relationships>',
    '<Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
  );
  if (source === 'docx')
    entries[path] =
      `<w:document xmlns:w="${XML}/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${documentText}</w:t></w:r></w:p></w:body></w:document>`;
  if (source === 'xlsx') {
    entries[path] =
      `<workbook xmlns="${XML}/spreadsheetml/2006/main" xmlns:r="${OFFICE}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Visible" sheetId="1" r:id="rId1"/><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Landscape" sheetId="3" r:id="rId3"/><sheet name="VeryHidden" sheetId="4" state="veryHidden" r:id="rId4"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Visible!$A$1:$B$3</definedName></definedNames><calcPr fullCalcOnLoad="1"/></workbook>`;
    entries['xl/_rels/workbook.xml.rels'] = relationships(
      [1, 2, 3, 4]
        .map((i) => relationship(`rId${i}`, 'worksheet', `worksheets/sheet${i}.xml`))
        .join(''),
    );
    for (const i of [1, 2, 3, 4]) {
      const label =
        i === 2 || i === 4 ? `HIDDEN_SENTINEL_${i}` : i === 1 ? documentText : 'LANDSCAPE_VISIBLE';
      entries[`xl/worksheets/sheet${i}.xml`] =
        `<worksheet xmlns="${XML}/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${label}</t></is></c></row><row r="2"><c r="A2"><f>SUM(21,21)</f><v>0</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>PRINT_AREA_END</t></is></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>${i === 1 ? 'OUTSIDE_PRINT_AREA' : 'TABLE_END'}</t></is></c></row></sheetData><pageSetup paperSize="9" orientation="${i === 3 ? 'landscape' : 'portrait'}"/></worksheet>`;
    }
  }
  if (source === 'pptx') {
    entries[path] =
      `<p:presentation xmlns:p="${XML}/presentationml/2006/main" xmlns:r="${OFFICE}"><p:sldIdLst>${[1, 2, 3].map((i) => `<p:sldId id="${255 + i}" r:id="rId${i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
    entries['ppt/_rels/presentation.xml.rels'] = relationships(
      [1, 2, 3].map((i) => relationship(`rId${i}`, 'slide', `slides/slide${i}.xml`)).join(''),
    );
    for (const i of [1, 2, 3]) {
      entries[`ppt/slides/slide${i}.xml`] =
        `<p:sld xmlns:p="${XML}/presentationml/2006/main" xmlns:a="${XML}/drawingml/2006/main"${i === 2 ? ' show="0"' : ''}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="8500000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="uk-UA" sz="1800"/><a:t>${i === 2 ? 'HIDDEN_SLIDE_SENTINEL' : i === 1 ? documentText : 'LAST_VISIBLE_SLIDE'}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    }
    entries['ppt/slides/_rels/slide1.xml.rels'] = relationships(
      relationship('rId9', 'notesSlide', '../notesSlides/notesSlide1.xml'),
    );
    entries['ppt/notesSlides/notesSlide1.xml'] =
      `<p:notes xmlns:p="${XML}/presentationml/2006/main" xmlns:a="${XML}/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>NOTES_SENTINEL</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
  }
  return entries;
}

export function odtEntries() {
  const ns = 'urn:oasis:names:tc:opendocument:xmlns:';
  return {
    mimetype: 'application/vnd.oasis.opendocument.text',
    'META-INF/manifest.xml': `<manifest:manifest xmlns:manifest="${ns}manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
    'content.xml': `<office:document-content xmlns:office="${ns}office:1.0" xmlns:text="${ns}text:1.0" office:version="1.2"><office:scripts/><office:body><office:text><text:p>${documentText}</text:p></office:text></office:body></office:document-content>`,
  };
}
export function documentFixtures() {
  return {
    docx: zipEntries(officeEntries('docx')),
    odt: zipEntries(odtEntries()),
    xlsx: zipEntries(officeEntries('xlsx')),
    pptx: zipEntries(officeEntries('pptx')),
    csv: Buffer.from(
      '\uFEFFLabel,Value\r\nUnicode,"' +
        documentText +
        '"\r\nZeros,0000123\r\nDate,01/02/2026\r\nDecimal,1.2300\r\nFormula,=1+1\r\nScientific,1e3\r\nQuoted,"comma, quote ""yes""\nnew line"\r\n',
    ),
    txt: Buffer.from(
      `\uFEFF${documentText}\r\nTabbed\tvalue\rLong line ${'word '.repeat(100)}\nEND_TEXT\n`,
    ),
  };
}
