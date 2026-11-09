import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { ConversionEngine } from '../dist/worker/modules/conversions/conversion-engine.js';
import { validateUpload } from '../dist/api/modules/conversions/upload-validation.js';
import {
  documentFixtures,
  officeEntries,
  odtEntries,
  documentText,
} from './fixtures/documents.mjs';
import { zipEntries } from './fixtures/docx.ts';

if (process.platform !== 'linux') throw Error('Actual Linux sandbox required.');
const directory = await mkdtemp('/tmp/document-matrix-');
const engine = new ConversionEngine();
const path = `${directory}/input`;
async function pdfDetails(bytes) {
  const file = `${directory}/output.pdf`;
  await writeFile(file, bytes);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  assert.match(
    execFileSync('pdffonts', [file], { encoding: 'utf8' }),
    /yes\s+yes\s+yes/,
    'embedded fonts and Unicode map',
  );
  return { info, text };
}
test('every document pair: real admission, sandbox, PDF parser and semantic content', async (t) => {
  for (const [source, bytes] of Object.entries(documentFixtures())) {
    await writeFile(path, bytes);
    assert.equal(
      (
        await validateUpload(
          { path, size: bytes.length, originalname: `input.${source}` },
          { targetFormat: 'pdf' },
        )
      ).format,
      source,
    );
    const start = Date.now();
    const pdf = await engine.convert(path, source, 'pdf');
    const { info, text } = await pdfDetails(pdf);
    assert.ok(text.includes(documentText), `${source}: Unicode content`);
    if (source === 'csv')
      for (const literal of [
        '0000123',
        '01/02/2026',
        '1.2300',
        '=1+1',
        '1e3',
        'comma, quote "yes"',
        'new line',
      ])
        assert.ok(text.includes(literal), `CSV literal ${literal}`);
    if (source === 'xlsx') {
      assert.ok(text.includes('42'), 'local formula recalculation');
      assert.ok(text.includes('LANDSCAPE_VISIBLE'));
      assert.ok(text.includes('PRINT_AREA_END'));
      assert.ok(!text.includes('HIDDEN_SENTINEL'));
      assert.ok(!text.includes('OUTSIDE_PRINT_AREA'));
      assert.match(info, /Pages:\s+2\b/);
      const sizes = [
        ...execFileSync('pdfinfo', ['-f', '1', '-l', '2', `${directory}/output.pdf`], {
          encoding: 'utf8',
        }).matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/g),
      ];
      assert.equal(sizes.length, 2);
      assert.ok(Number(sizes[0][1]) < Number(sizes[0][2]), 'portrait sheet');
      assert.ok(Number(sizes[1][1]) > Number(sizes[1][2]), 'landscape sheet');
    }
    if (source === 'pptx') {
      assert.ok(text.includes('LAST_VISIBLE_SLIDE'));
      assert.ok(!text.includes('HIDDEN_SLIDE_SENTINEL'));
      assert.ok(!text.includes('NOTES_SENTINEL'));
      assert.match(info, /Pages:\s+2\b/);
    }
    t.diagnostic(
      `${source}->pdf: ${pdf.length} bytes, ${Date.now() - start}ms; parsed Unicode, page/content rules`,
    );
  }
});
test('unsafe document sources are rejected at admission and again in the worker', async () => {
  const reject = async (source, bytes) => {
    await writeFile(path, bytes);
    await assert.rejects(
      validateUpload(
        { path, size: bytes.length, originalname: `input.${source}` },
        { targetFormat: 'pdf' },
      ),
      { status: 422 },
    );
    await assert.rejects(engine.convert(path, source, 'pdf'));
  };
  for (const source of ['xlsx', 'pptx', 'odt']) {
    const entries = source === 'odt' ? odtEntries() : officeEntries(source);
    const name =
      source === 'odt'
        ? 'content.xml'
        : source === 'xlsx'
          ? 'xl/workbook.xml'
          : 'ppt/presentation.xml';
    await reject(
      source,
      zipEntries({
        ...entries,
        [name]: '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>' + entries[name],
      }),
    );
    await reject(source, zipEntries({ ...entries, 'malicious/vbaProject.bin': 'synthetic' }));
    await reject(
      source,
      zipEntries({
        ...entries,
        'media/disguised.png':
          '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>',
      }),
    );
    await reject(
      source,
      zipEntries({ ...entries, 'inline.xml': '<binary-data>PHN2Zy8+</binary-data>' }),
    );
    await reject(source, zipEntries({ ...entries, 'outside.xml': '<x xml:base="file:///usr/"/>' }));
    await reject(source, zipEntries({ ...entries, 'outside.xml': '<x><![CDATA[synthetic]]></x>' }));
    await reject(
      source,
      zipEntries({ ...entries, 'outside.xml': '<x href="file:///etc/passwd"/>' }),
    );
    await reject(
      source,
      zipEntries({ ...entries, 'outside.xml': '<x href="https://example.test/resource"/>' }),
    );
    await reject(
      source,
      zipEntries({ ...entries, 'outside.xml': '<x href="https&#58;//example.test/resource"/>' }),
    );
    await reject(source, zipEntries({ ...entries, 'outside.xml': '<x><script/></x>' }));
    const broken = zipEntries(entries);
    broken[50] ^= 255;
    await reject(source, broken);
    const encrypted = zipEntries(entries);
    encrypted.writeUInt16LE(1, 6);
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(1, central + 8);
    await reject(source, encrypted);
  }
  const xlsx = officeEntries('xlsx');
  await reject(
    'xlsx',
    zipEntries({
      ...xlsx,
      'xl/workbook.xml': xlsx['xl/workbook.xml'].replace(
        /<sheet name="(Visible|Landscape)"/g,
        '<sheet state="hidden" name="$1"',
      ),
    }),
  );
  const pptx = officeEntries('pptx');
  for (const name of ['ppt/slides/slide1.xml', 'ppt/slides/slide3.xml'])
    pptx[name] = pptx[name].replace('<p:sld ', '<p:sld show="false" ');
  await reject('pptx', zipEntries(pptx));
  await reject(
    'xlsx',
    zipEntries({
      ...xlsx,
      'xl/worksheets/sheet1.xml': xlsx['xl/worksheets/sheet1.xml'].replace(
        'SUM(21,21)',
        'WEBSERVICE("https://example.test")',
      ),
    }),
  );
  for (const text of [
    'a;b\n1;2',
    'a\tb\n1\t2',
    'a,b\n"broken',
    'a,b\n1,2,3',
    'a,b\n1,\u0000',
    'a,b\n1,"x"oops',
  ])
    await reject('csv', Buffer.from(text));
  for (const source of ['csv', 'txt'])
    for (const bytes of [
      Buffer.from([0xff, 0xfe, 65, 0]),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('\u0000'),
      Buffer.from('   '),
    ])
      await reject(source, bytes);
});
test('long CSV/TXT paginate with final content preserved, and resource bounds fail safely', async () => {
  for (const source of ['csv', 'txt']) {
    const text =
      source === 'csv'
        ? 'Name,Value\n' +
          Array.from({ length: 200 }, (_, i) => `Row${i},000${i}`).join('\n') +
          '\nEND_TABLE,END_VALUE'
        : 'Long text Україна\n'.repeat(300) + 'END_TEXT_CONTENT';
    await writeFile(path, text);
    const { info, text: content } = await pdfDetails(await engine.convert(path, source, 'pdf'));
    assert.ok(Number(info.match(/Pages:\s+(\d+)/)[1]) > 1);
    assert.ok(content.includes(source === 'csv' ? 'END_VALUE' : 'END_TEXT_CONTENT'));
  }
  const args = (
    await import('../dist/worker/modules/conversions/conversion-engine.js')
  ).sandboxArguments('/dev/null', 'txt', 'pdf');
  args.splice(-3, 3, '-e', 'Buffer.alloc(2147483648); process.stdout.write("unexpected");');
  await assert.rejects(engine.run(args), 'address-space bound must prevent allocation');
});
test('attempt profiles remain isolated during simultaneous document conversions', async () => {
  const fixtures = documentFixtures();
  const jobs = await Promise.all(
    ['txt', 'csv'].map(async (source) => {
      const input = `${directory}/${source}`;
      await writeFile(
        input,
        fixtures[source].toString('utf8').trimEnd() +
          (source === 'csv' ? '\nMarker,CSV_ATTEMPT_SENTINEL' : '\nTXT_ATTEMPT_SENTINEL'),
      );
      return engine.convert(input, source, 'pdf');
    }),
  );
  for (const [index, output] of jobs.entries()) {
    const { text } = await pdfDetails(output);
    assert.ok(text.includes(index === 0 ? 'TXT_ATTEMPT_SENTINEL' : 'CSV_ATTEMPT_SENTINEL'));
    assert.ok(!text.includes(index === 0 ? 'CSV_ATTEMPT_SENTINEL' : 'TXT_ATTEMPT_SENTINEL'));
  }
});
test('cleanup', async () => {
  engine.beforeApplicationShutdown();
  await rm(directory, { recursive: true, force: true });
});
