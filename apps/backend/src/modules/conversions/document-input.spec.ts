import { csvSpreadsheet, parseCsv, validateDocument, validateText } from './document-input.js';
import { zipEntries } from '../../../test/fixtures/docx.js';

describe('deterministic document admission', () => {
  it('retains literal CSV cells and creates only typed string cells', () => {
    const input = Buffer.from(
      '\uFEFFa,b\r\n0001,=1+1\r\n01/02/2026,1e3\r\n"quote ""yes""","line\nnext"\r\n',
    );
    expect(parseCsv(input)).toEqual([
      ['a', 'b'],
      ['0001', '=1+1'],
      ['01/02/2026', '1e3'],
      ['quote "yes"', 'line\nnext'],
    ]);
    const xml = csvSpreadsheet(input);
    expect(xml.match(/office:value-type="string"/g)).toHaveLength(8);
    expect(xml).not.toContain('table:formula');
    expect(xml).toContain('0001');
    expect(xml).toContain('<text:line-break/>');
    expect(csvSpreadsheet(Buffer.from('a,b\n<>&,0001'))).toContain('&lt;&gt;&amp;');
  });
  it.each([
    'a;b\n1;2',
    'a\tb\n1\t2',
    'a,b\n"unclosed',
    'a,b\n"closed"oops,2',
    'a,b\n1,2,3',
    'one column',
  ])('rejects ambiguous or malformed CSV %p', (text) => {
    expect(() => parseCsv(Buffer.from(text))).toThrow();
  });
  it.each([Buffer.alloc(0), Buffer.from([0xff]), Buffer.from('a\u0000b'), Buffer.from('   ')])(
    'rejects unsafe text %#',
    (bytes) => {
      expect(() => validateText(bytes)).toThrow();
    },
  );
  it('normalizes newlines without guessing an encoding', () => {
    expect(validateText(Buffer.from('\uFEFFУкраїна\r\n\tline\rnext'))).toBe(
      'Україна\n\tline\nnext',
    );
  });
  it('rejects generic archives and archive expansion before XML import', () => {
    expect(() => validateDocument(zipEntries({ 'content.xml': '<x/>' }), 'odt')).toThrow();
    expect(() =>
      validateDocument(zipEntries({ 'huge.xml': 'x'.repeat(100_000) }), 'xlsx'),
    ).toThrow();
    expect(() => validateDocument(Buffer.from([0x50, 0x4b]), 'pptx')).toThrow();
  });
  it('bounds CSV cell, row and column expansion', () => {
    expect(() => parseCsv(Buffer.from('a,b\n' + 'x'.repeat(32_768) + ',y'))).toThrow();
    expect(() => parseCsv(Buffer.from(Array(257).fill('x').join(',')))).toThrow();
    expect(() => parseCsv(Buffer.from('a,b\n'.repeat(10_001)))).toThrow();
  });
});
