import { describe, expect, it } from 'vitest';
import { FILE_ACCEPT, getTargetFormats, validateFileSelection } from './file-selection';

describe('document format selection', () => {
  it.each(['odt', 'xlsx', 'pptx', 'csv', 'txt'] as const)(
    'selects %s with PDF as its only target',
    (source) => {
      const file = new File(['synthetic'], `owned.${source}`);
      expect(validateFileSelection([file])).toMatchObject({
        ok: true,
        selection: { file, sourceFormat: source, targetFormat: 'pdf' },
      });
      expect(getTargetFormats(source)).toEqual(['pdf']);
      expect(FILE_ACCEPT.split(',')).toContain(`.${source}`);
    },
  );
});
