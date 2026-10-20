import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE_BYTES, validateFileSelection } from './file-selection';

describe('file-selection boundaries', () => {
  it('accepts exactly 20 decimal MB and rejects one byte over the limit', () => {
    const file = new File(['x'], 'image.png');
    Object.defineProperty(file, 'size', { value: MAX_FILE_SIZE_BYTES, configurable: true });
    expect(validateFileSelection([file]).ok).toBe(true);
    Object.defineProperty(file, 'size', { value: MAX_FILE_SIZE_BYTES + 1 });
    expect(validateFileSelection([file])).toEqual({
      ok: false,
      error: 'Файл завеликий. Максимальний розмір — 20 МБ.',
    });
  });

  it('rejects an empty file, extensionless file, and unsupported input formats', () => {
    expect(validateFileSelection([new File([], 'empty.jpg')]).ok).toBe(false);
    for (const name of ['image', 'file.pdf', 'file.txt', 'image.png.exe']) {
      expect(validateFileSelection([new File(['x'], name, { type: 'image/png' })]).ok).toBe(false);
    }
  });
});
