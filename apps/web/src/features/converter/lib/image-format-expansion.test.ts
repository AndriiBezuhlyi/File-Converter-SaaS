import { describe, expect, it } from 'vitest';
import { getTargetFormats, validateFileSelection, type SourceFormat } from './file-selection';

describe('approved image selection matrix', () => {
  const matrix: Record<string, readonly string[]> = {
    jpg: ['png', 'webp', 'avif'],
    png: ['jpg', 'webp', 'avif'],
    webp: ['jpg', 'png', 'avif'],
    avif: ['jpg', 'png', 'webp'],
    gif: ['jpg', 'png', 'webp', 'avif'],
    svg: ['jpg', 'png', 'webp', 'avif'],
  };
  it.each(Object.entries(matrix))('offers only approved outputs for %s', (source, targets) => {
    expect(getTargetFormats(source as SourceFormat)).toEqual(targets);
    expect(validateFileSelection([new File(['synthetic'], `input.${source}`)])).toMatchObject({
      ok: true,
      selection: { sourceFormat: source, targetFormat: targets[0] },
    });
    expect(targets).not.toContain(source);
    expect(targets).not.toContain('gif');
    expect(targets).not.toContain('svg');
  });
});
