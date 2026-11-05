import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { documentArchive, zipEntries } from '../../../test/fixtures/docx.js';
import { validateUpload } from './upload-validation.js';
import { MAX_UPLOAD_BYTES } from './conversion-policy.js';

describe('untrusted upload validation', () => {
  let directory: string;
  let sequence = 0;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'converter-validation-'));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const validate = async (bytes: Buffer, targetFormat = 'png') => {
    const path = join(directory, String(sequence++));
    await writeFile(path, bytes);
    return validateUpload(
      { path, size: bytes.length, originalname: 'untrusted.exe' },
      { targetFormat },
    );
  };
  it('detects JPEG/PNG and DOCX bytes independently of MIME and filename', async () => {
    const image = sharp({ create: { width: 2, height: 3, channels: 3, background: '#fff' } });
    await expect(validate(await image.jpeg().toBuffer())).resolves.toMatchObject({
      format: 'jpg',
      target: 'png',
    });
    await expect(validate(await image.png().toBuffer(), 'jpg')).resolves.toMatchObject({
      format: 'png',
      target: 'jpg',
    });
    await expect(validate(documentArchive(), 'pdf')).resolves.toMatchObject({
      format: 'docx',
      target: 'pdf',
    });
  });
  it('rejects empty, unknown, malformed and unsupported directions', async () => {
    await expect(validate(Buffer.alloc(0))).rejects.toMatchObject({ status: 422 });
    await expect(validate(Buffer.from('not an image'))).rejects.toMatchObject({ status: 415 });
    await expect(validate(Buffer.from([255, 216, 255, 0]))).rejects.toMatchObject({ status: 422 });
    await expect(validate(documentArchive(), 'png')).rejects.toMatchObject({ status: 422 });
  });
  it('rejects excessive bytes and duplicate/extra multipart fields', async () => {
    await expect(
      validateUpload(
        { path: 'unused', size: MAX_UPLOAD_BYTES + 1, originalname: 'owned.jpg' },
        { targetFormat: 'png' },
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      validateUpload(
        { path: 'unused', size: 1, originalname: 'owned.jpg' },
        { targetFormat: ['png', 'png'] },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(validateUpload(undefined, { targetFormat: 'png' })).rejects.toMatchObject({
      status: 400,
    });
  });
  it('rejects image pixel expansion before decoding', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    png.writeUInt32BE(100_000, 16);
    png.writeUInt32BE(100_000, 20);
    await expect(validate(png, 'jpg')).rejects.toMatchObject({ status: 422 });
  });
  it.each([
    { '../escape.xml': '<test/>' },
    { 'word/vbaProject.bin': 'macro' },
    { 'word/embeddings/program.exe': 'program' },
    {
      'word/_rels/document.xml.rels':
        '<Relationship TargetMode="External" Target="https://example.test"/>',
    },
    { 'word/document.xml': '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><document/>' },
    { 'word/huge.xml': 'x'.repeat(100_000) },
  ])('rejects unsafe archive content %#', async (entries) => {
    await expect(validate(documentArchive(entries), 'pdf')).rejects.toMatchObject({ status: 422 });
  });
  it('rejects generic ZIP, truncation, checksum corruption and excessive entry counts', async () => {
    const archive = documentArchive();
    await expect(validate(zipEntries({ 'plain.txt': 'hello' }), 'pdf')).rejects.toMatchObject({
      status: 422,
    });
    await expect(validate(archive.subarray(0, -1), 'pdf')).rejects.toMatchObject({ status: 422 });
    archive[35] = archive[35]! ^ 255;
    await expect(validate(archive, 'pdf')).rejects.toMatchObject({ status: 422 });
    const many = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`part${i}.txt`, 'x']));
    await expect(validate(zipEntries(many), 'pdf')).rejects.toMatchObject({ status: 422 });
  });
});
