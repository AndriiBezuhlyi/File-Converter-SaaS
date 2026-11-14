import { jest } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { documentFixtures, officeEntries, odtEntries } from '../../../test/fixtures/documents.mjs';
import { zipEntries } from '../../../test/fixtures/docx.js';

const archive = await import('./docx-validation.js');
const readArchive = jest.fn(archive.readDocumentArchive);
jest.unstable_mockModule('./docx-validation.js', () => ({
  ...archive,
  readDocumentArchive: readArchive,
}));
const { validateUpload } = await import('./upload-validation.js');
const { validateDocument } = await import('./document-input.js');

describe('request-local document admission validation', () => {
  let directory: string;
  let sequence = 0;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'f04-admission-'));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true });
  });
  const admit = async (bytes: Buffer) => {
    const path = join(directory, String(sequence++));
    await writeFile(path, bytes);
    return validateUpload(
      { path, size: bytes.length, originalname: 'synthetic.bin' },
      {
        targetFormat: 'pdf',
      },
    );
  };

  it.each(['docx', 'odt', 'xlsx', 'pptx'] as const)(
    'parses %s once per admission and independently on worker validation',
    async (source) => {
      const bytes = documentFixtures()[source];
      await expect(admit(bytes)).resolves.toMatchObject({ format: source, target: 'pdf' });
      expect(readArchive).toHaveBeenCalledTimes(1);
      validateDocument(bytes, source);
      expect(readArchive).toHaveBeenCalledTimes(2);
      await expect(admit(bytes)).resolves.toMatchObject({ format: source });
      expect(readArchive).toHaveBeenCalledTimes(3);
    },
  );

  it.each(['docx', 'odt', 'xlsx', 'pptx'] as const)(
    'still rejects invalid %s main content after successful archive detection',
    async (source) => {
      const entries = source === 'odt' ? odtEntries() : officeEntries(source);
      const main =
        source === 'docx'
          ? 'word/document.xml'
          : source === 'odt'
            ? 'content.xml'
            : source === 'xlsx'
              ? 'xl/workbook.xml'
              : 'ppt/presentation.xml';
      entries[main] = '<wrong/>';
      await expect(admit(zipEntries(entries))).rejects.toMatchObject({ status: 422 });
      expect(readArchive).toHaveBeenCalledTimes(1);
    },
  );

  it('does not reuse accepted content for a subsequent unsafe upload', async () => {
    await admit(documentFixtures().docx);
    await expect(
      admit(zipEntries({ ...officeEntries('docx'), 'word/vbaProject.bin': 'macro' })),
    ).rejects.toMatchObject({ status: 422 });
    expect(readArchive).toHaveBeenCalledTimes(2);
  });
});
