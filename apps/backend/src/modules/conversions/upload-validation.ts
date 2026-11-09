import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ConversionEngine, EngineFailure } from './conversion-engine.js';
import { AuthError } from '../auth/auth-error.js';
import { readDocumentArchive } from './docx-validation.js';
import { isDocumentSource, validateDocument } from './document-input.js';
import {
  CONVERSION_DIRECTIONS,
  MAX_IMAGE_PIXELS,
  MAX_UPLOAD_BYTES,
  type SourceFormat,
  type TargetFormat,
} from './conversion-policy.js';

export interface StagedUpload {
  path: string;
  size: number;
  originalname: string;
}
const imageValidator = new ConversionEngine();
let validatingImage = false;
export async function validateUpload(file: StagedUpload | undefined, body: unknown) {
  if (
    !file ||
    !body ||
    typeof body !== 'object' ||
    Object.keys(body).length !== 1 ||
    !('targetFormat' in body) ||
    typeof body.targetFormat !== 'string' ||
    !['jpg', 'png', 'webp', 'avif', 'pdf'].includes(String(body.targetFormat))
  )
    throw new AuthError(400, 'VALIDATION_FAILED', 'Provide one file and a supported targetFormat.');
  if (file.size > MAX_UPLOAD_BYTES)
    throw new AuthError(413, 'FILE_TOO_LARGE', 'The uploaded file exceeds the allowed size.');
  if (!file.size) throw new AuthError(422, 'INVALID_FILE', 'The uploaded file is empty.');
  const bytes = await readFile(file.path);
  if (bytes.length !== file.size || bytes.length > MAX_UPLOAD_BYTES)
    throw new AuthError(413, 'FILE_TOO_LARGE', 'The uploaded file exceeds the allowed size.');
  let format: SourceFormat;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) format = 'png';
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) format = 'jpg';
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    format = 'webp';
  else if (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a')
    format = 'gif';
  else if (bytes.toString('ascii', 4, 8) === 'ftyp') format = 'avif';
  else if (bytes.length >= 22 && bytes.readUInt32LE(0) === 0x04034b50) {
    try {
      const entries = readDocumentArchive(bytes);
      if (entries.has('word/document.xml')) format = 'docx';
      else if (entries.has('xl/workbook.xml')) format = 'xlsx';
      else if (entries.has('ppt/presentation.xml')) format = 'pptx';
      else if (entries.has('mimetype')) format = 'odt';
      else throw new Error('Unknown archive.');
    } catch {
      throw new AuthError(422, 'INVALID_FILE', 'The document archive is malformed or unsupported.');
    }
  } else if (/\.(?:csv|txt)$/i.test(file.originalname))
    format = /\.csv$/i.test(file.originalname) ? 'csv' : 'txt';
  else if (
    bytes.toString('utf8', 0, 256).trimStart().startsWith('<') ||
    bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]))
  )
    format = 'svg';
  else throw new AuthError(415, 'UNSUPPORTED_FORMAT', 'Unsupported input format.');
  try {
    if (isDocumentSource(format)) validateDocument(bytes, format);
    else if (format !== 'jpg' && format !== 'png') {
      if (validatingImage)
        throw new AuthError(
          429,
          'UPLOAD_CAPACITY_REACHED',
          'Image validation is temporarily full.',
        );
      validatingImage = true;
      try {
        await imageValidator.validateImage(file.path, format);
      } catch (error) {
        if (!(error instanceof EngineFailure))
          throw new AuthError(
            503,
            'SERVICE_UNAVAILABLE',
            'Image validation sandbox is unavailable.',
          );
        throw error;
      } finally {
        validatingImage = false;
      }
    } else {
      const metadata = await sharp(bytes, {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: 'warning',
      }).metadata();
      if (
        metadata.format !== (format === 'jpg' ? 'jpeg' : 'png') ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error('Invalid image dimensions.');
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      422,
      'INVALID_FILE',
      'The file is malformed, animated, unsupported SVG content, or exceeds safe resource limits.',
    );
  }
  const target = body.targetFormat as TargetFormat;
  if (!(CONVERSION_DIRECTIONS[format] as readonly string[]).includes(target))
    throw new AuthError(
      422,
      'UNSUPPORTED_CONVERSION',
      'This conversion direction is not supported.',
    );
  const name =
    Array.from(file.originalname, (character) =>
      character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127 ||
      character === '/' ||
      character === '\\'
        ? '_'
        : character,
    )
      .join('')
      .slice(0, 200)
      .trim() || `input.${format}`;
  return { format, target, name, sizeBytes: bytes.length };
}
