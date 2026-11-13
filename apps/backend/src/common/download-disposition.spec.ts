import { downloadDisposition } from './download-disposition.js';

it.each([
  'Зображення червень.png',
  'café déjà vu.png',
  'two spaces image.png',
  'Фото été 東京 12.png',
])('encodes a Unicode download name with an ASCII fallback: %s', (name) => {
  const header = downloadDisposition(name);
  expect(header).toMatch(/^attachment; filename="conversion.png"; filename\*=UTF-8''/);
  expect(header).not.toMatch(/[^\x20-\x7e]/);
  expect(decodeURIComponent(header.split("UTF-8''")[1]!)).toBe(name);
});
it('cannot inject paths, headers or unsafe fallback extensions', () => {
  const header = downloadDisposition('../bad\r\nX-Injected: yes."');
  expect(header).not.toMatch(/[\r\n]/);
  expect(header).toContain('filename="conversion.bin";');
  expect(decodeURIComponent(header.split("UTF-8''")[1]!)).not.toMatch(/[\\/\r\n]/);
});
