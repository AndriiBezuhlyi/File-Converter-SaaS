import { posix } from 'node:path';
import { SaxesParser } from 'saxes';
import { readDocumentArchive, validateDocx } from './docx-validation.js';
import { MAX_UPLOAD_BYTES } from './conversion-policy.js';

export const DOCUMENT_SOURCES = ['docx', 'odt', 'xlsx', 'pptx', 'csv', 'txt'] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];
export const isDocumentSource = (source: string): source is DocumentSource =>
  (DOCUMENT_SOURCES as readonly string[]).includes(source);
const reject: () => never = () => {
  throw new Error('Unsupported or unsafe document.');
};
const utf8 = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ODF = 'urn:oasis:names:tc:opendocument:xmlns:';

export function validateText(bytes: Buffer): string {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) reject();
  const text = utf8(bytes).replace(/\r\n?/g, '\n');
  if (!text.trim()) reject();
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (
      (point < 32 && point !== 9 && point !== 10) ||
      (point >= 127 && point <= 159) ||
      point === 65534 ||
      point === 65535
    )
      reject();
  }
  return text;
}

// One deterministic dialect. No separator/encoding/locale inference or formula parsing.
export function parseCsv(bytes: Buffer): string[][] {
  const text = validateText(bytes);
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  let cells = 0;
  const finishCell = () => {
    if (cell.length > 32_767 || ++cells > 100_000 || row.length >= 256) reject();
    row.push(cell);
    cell = '';
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    if (rows.length >= 10_000 || (rows.length && row.length !== rows[0]!.length)) reject();
    rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === ',') finishCell();
    else if (char === '\n') finishRow();
    else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || char === '"' || char === ';' || char === '\t') reject();
      cell += char;
    }
    if (cell.length > 32_767) reject();
  }
  if (quoted) reject();
  if (cell || row.length || closed) finishRow();
  if (!rows.length || rows[0]!.length < 2) reject();
  return rows;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Explicit ODF string cells avoid Calc's numeric/date/formula import heuristics entirely.
export function csvSpreadsheet(bytes: Buffer): string {
  const rows = parseCsv(bytes)
    .map(
      (row) =>
        '<table:table-row>' +
        row
          .map(
            (cell) =>
              '<table:table-cell office:value-type="string"><text:p>' +
              escapeXml(cell)
                .replace(/ +/g, (spaces) => `<text:s text:c="${spaces.length}"/>`)
                .replace(/\t/g, '<text:tab/>')
                .replace(/\n/g, '<text:line-break/>') +
              '</text:p></table:table-cell>',
          )
          .join('') +
        '</table:table-row>',
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="${ODF}office:1.0" xmlns:table="${ODF}table:1.0" xmlns:text="${ODF}text:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.spreadsheet"><office:body><office:spreadsheet><table:table table:name="CSV">${rows}</table:table></office:spreadsheet></office:body></office:document>`;
}

export function validateDocument(bytes: Buffer, source: DocumentSource): void {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) reject();
  if (source === 'txt') {
    validateText(bytes);
    return;
  }
  if (source === 'csv') {
    parseCsv(bytes);
    return;
  }
  if (source === 'docx') {
    validateDocx(bytes);
    return;
  }
  const entries = readDocumentArchive(bytes);
  let visibleSheets = 0;
  const referencedSlides: string[] = [];
  const slideRelations = new Map<string, string>();
  const slideVisibility = new Map<string, boolean>();
  let root = '',
    mainType = false,
    officeRelationship = false,
    odfText = false,
    odfManifest = false;
  for (const [name, data] of entries) {
    if (name.endsWith('/')) continue;
    if (
      /externalLinks|connections|queryTables|pivotCache|customXml|scripts|Basic\/|Object\s*\d|\.svg$/i.test(
        name,
      )
    )
      reject();
    if (!/\.(?:xml|rels|png|jpe?g)$/i.test(name) && name !== 'mimetype') reject();
    if (
      /\.png$/i.test(name) &&
      !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      reject();
    if (/\.jpe?g$/i.test(name) && !(data[0] === 255 && data[1] === 216 && data[2] === 255))
      reject();
    if (!/\.(?:xml|rels)$/i.test(name)) continue;
    const text = utf8(data);
    const parser = new SaxesParser({ xmlns: true });
    let depth = 0,
      count = 0;
    let formula: string | undefined;
    let scriptsDepth: number | undefined;
    parser.on('error', reject);
    parser.on('doctype', reject);
    parser.on('processinginstruction', reject);
    parser.on('cdata', reject);
    parser.on('xmldecl', (d) => {
      if (d.version !== '1.0' || (d.encoding && !/^utf-8$/i.test(d.encoding))) reject();
    });
    parser.on('opentag', (tag) => {
      if (++depth > 128 || ++count > 200_000 || Object.keys(tag.attributes).length > 128) reject();
      if (formula !== undefined) reject();
      if (scriptsDepth !== undefined) reject();
      if (tag.local === 'scripts' && tag.uri === `${ODF}office:1.0`) scriptsDepth = depth;
      if (name === 'content.xml' && tag.local === 'text' && tag.uri === `${ODF}office:1.0`)
        odfText = true;
      if (
        name === 'META-INF/manifest.xml' &&
        depth === 1 &&
        tag.local === 'manifest' &&
        tag.uri === `${ODF}manifest:1.0`
      )
        odfManifest = true;
      if (
        source === 'xlsx' &&
        name === 'xl/workbook.xml' &&
        tag.local === 'sheet' &&
        tag.uri === 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
      ) {
        const state = tag.attributes.state?.value ?? 'visible';
        if (!['visible', 'hidden', 'veryHidden'].includes(state)) reject();
        if (state === 'visible') visibleSheets++;
      }
      if (
        source === 'pptx' &&
        tag.uri === 'http://schemas.openxmlformats.org/presentationml/2006/main'
      ) {
        if (depth === 1 && tag.local === 'sld') {
          const show = tag.attributes.show?.value ?? 'true';
          if (!['true', 'false', '1', '0'].includes(show)) reject();
          slideVisibility.set(name, show === 'true' || show === '1');
        }
        if (name === 'ppt/presentation.xml' && tag.local === 'sldId') {
          const id = Object.values(tag.attributes).find(
            (a) => a.uri === OFFICE && a.local === 'id',
          )?.value;
          if (!id) reject();
          referencedSlides.push(id);
        }
      }
      if (
        source === 'pptx' &&
        name === 'ppt/_rels/presentation.xml.rels' &&
        tag.local === 'Relationship' &&
        tag.attributes.Type?.value === `${OFFICE}/slide`
      ) {
        const id = tag.attributes.Id?.value,
          target = tag.attributes.Target?.value;
        if (!id || !target || slideRelations.has(id)) reject();
        slideRelations.set(id, posix.normalize(posix.join('ppt', target)));
      }
      if (
        depth === 1 &&
        name ===
          (source === 'odt'
            ? 'content.xml'
            : source === 'xlsx'
              ? 'xl/workbook.xml'
              : 'ppt/presentation.xml')
      )
        root = `${tag.uri}|${tag.local}`;
      if (
        /^(?:script|event-listener|binary-data|object(?:-ole)?|applet|plugin|dde.*|oleObject|controls?|externalReferences?|externalData|altChunk|encryption(?:-data)?)$/i.test(
          tag.local,
        )
      )
        reject();
      if (source === 'xlsx' && ['f', 'definedName', 'formula1', 'formula2'].includes(tag.local))
        formula = '';
      for (const attr of Object.values(tag.attributes)) {
        if (attr.value.length > 1_000_000) reject();
        if (attr.uri === 'http://www.w3.org/XML/1998/namespace' && attr.local === 'base') reject();
        if (attr.local === 'ContentType' && name === '[Content_Types].xml') {
          if (/macro|activex|oleObject|externalLink/i.test(attr.value)) reject();
          if (
            attr.value ===
            `application/vnd.openxmlformats-officedocument.${source === 'xlsx' ? 'spreadsheetml.sheet' : 'presentationml.presentation'}.main+xml`
          )
            mainType = true;
        }
        if (tag.local === 'Relationship' && attr.local === 'Type') {
          if (
            /^(?:vbaProject|oleObject|attachedTemplate|externalLink(?:Path)?|connections?|control|ctrlProp|package)$/i.test(
              attr.value.split('/').at(-1) ?? '',
            )
          )
            reject();
          if (name === '_rels/.rels' && attr.value === `${OFFICE}/officeDocument`)
            officeRelationship = true;
        }
        if (attr.local === 'TargetMode' && attr.value.toLowerCase() !== 'internal') reject();
        if (
          attr.local === 'href' ||
          attr.local === 'src' ||
          (tag.local === 'Relationship' && attr.local === 'Target')
        ) {
          const target = attr.value;
          if (target.startsWith('#')) continue;
          if (!target || /[:\\%?#]/.test(target) || target.startsWith('/')) reject();
          const base = name.endsWith('.rels')
            ? posix.dirname(name).replace(/(?:^|\/)_rels$/, '')
            : posix.dirname(name);
          if (!entries.has(posix.normalize(posix.join(base, target)))) reject();
        }
      }
    });
    parser.on('closetag', (tag) => {
      if (scriptsDepth === depth) scriptsDepth = undefined;
      if (source === 'xlsx' && ['f', 'definedName', 'formula1', 'formula2'].includes(tag.local)) {
        if (
          /(?:\[[^\]]*\]|\||\b(?:WEBSERVICE|HYPERLINK|DDE|RTD|IMAGE|FILTERXML|STOCKHISTORY|INDIRECT)\s*\()/i.test(
            formula ?? '',
          )
        )
          reject();
        formula = undefined;
      }
      depth--;
    });
    parser.on('text', (value) => {
      if (scriptsDepth !== undefined && value.trim()) reject();
      // Local formulas may recalculate; external/DDE data sources never reach Calc.
      if (formula !== undefined) formula += value;
    });
    for (let offset = 0; offset < text.length; offset += 4096)
      parser.write(text.slice(offset, offset + 4096));
    parser.close();
  }
  if (source === 'odt') {
    if (
      entries.get('mimetype')?.toString() !== 'application/vnd.oasis.opendocument.text' ||
      !entries.has('META-INF/manifest.xml') ||
      !odfText ||
      !odfManifest ||
      root !== `${ODF}office:1.0|document-content`
    )
      reject();
  } else if (
    !mainType ||
    !officeRelationship ||
    root !==
      `http://schemas.openxmlformats.org/${source === 'xlsx' ? 'spreadsheetml' : 'presentationml'}/2006/main|${source === 'xlsx' ? 'workbook' : 'presentation'}`
  )
    reject();
  if (source === 'xlsx' && !visibleSheets) reject();
  if (
    source === 'pptx' &&
    (!referencedSlides.length ||
      referencedSlides.some((id) => !slideVisibility.has(slideRelations.get(id) ?? '')) ||
      !referencedSlides.some((id) => slideVisibility.get(slideRelations.get(id) ?? '')))
  )
    reject();
}
