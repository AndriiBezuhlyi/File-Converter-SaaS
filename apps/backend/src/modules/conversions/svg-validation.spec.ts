import { validateSvg } from './svg-validation.js';

const svg = (body: string, attributes = '') =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" ${attributes}>${body}</svg>`,
  );
describe('static SVG allowlist', () => {
  it('accepts bounded geometry with numeric entities and explicit dimensions', () => {
    expect(() =>
      validateSvg(
        svg(
          '<g fill="&#35;ff0000"><rect width="20" height="10"/><path d="M0 0 L10 10 Z"/></g>',
          'viewBox="0 0 40 30"',
        ),
      ),
    ).not.toThrow();
  });
  it.each([
    '<script>alert(1)</script>',
    '<image href="https://example.test/x"/>',
    '<image href="file:///etc/passwd"/>',
    '<image href="data:image/png;base64,AA=="/>',
    '<use href="#shape"/>',
    '<foreignObject/>',
    '<style>@import "https://example.test";</style>',
    '<text>font input</text>',
    '<animate attributeName="x"/>',
    '<rect onload="alert(1)"/>',
    '<rect style="fill:url(file:///etc/passwd)"/>',
    '<rect fill="url(&#104;ttps://example.test)"/>',
    '<rect xmlns="http://evil.test"/>',
    '<s:rect xmlns:s="http://www.w3.org/2000/svg"/>',
    '<rect xml:base="file:///etc/"/>',
    '<rect xlink:href="https://example.test" xmlns:xlink="http://www.w3.org/1999/xlink"/>',
    '<rect width="1" width="2"/>',
    '<![CDATA[<script/>]]>',
    '<rect/>trailing text',
    '<svg width="10" height="10"/>',
    '<g>'.repeat(33) + '</g>'.repeat(33),
    '<rect/>'.repeat(10_001),
    '<path d="' + 'M0 0 '.repeat(25_000) + '"/>',
  ])('rejects unsafe or excessive structure %#', (body) => {
    expect(() => validateSvg(svg(body))).toThrow();
  });
  it.each([
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>',
    '<!DOCTYPE svg SYSTEM "https://example.test/evil.dtd">',
    '<!DOCTYPE svg [<!ENTITY x "expanded">]>',
    '<?xml-stylesheet href="https://example.test/x.css"?>',
  ])('rejects declarations before rasterization %#', (prefix) => {
    expect(() => validateSvg(Buffer.concat([Buffer.from(prefix), svg('')]))).toThrow();
  });
  it('rejects malformed XML, unknown entities, encodings and dimensions', () => {
    for (const bytes of [
      Buffer.from('<svg>'),
      svg('&unknown;'),
      svg('', 'width="1"'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"/>'),
      Buffer.concat([Buffer.from('<?xml version="1.0" encoding="UTF-16"?>'), svg('')]),
      Buffer.from([0xff, 0xfe, 0x3c, 0]),
    ])
      expect(() => validateSvg(bytes)).toThrow();
  });
});
