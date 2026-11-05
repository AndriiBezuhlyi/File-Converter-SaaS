import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { AuthError } from '../auth/auth-error.js';
import { validateDocx } from './docx-validation.js';
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
export async function validateUpload(file: StagedUpload | undefined, body: unknown) {
  if (
    !file ||
    !body ||
    typeof body !== 'object' ||
    Object.keys(body).length !== 1 ||
    !('targetFormat' in body) ||
    typeof body.targetFormat !== 'string' ||
    !['jpg', 'png', 'pdf'].includes(String(body.targetFormat))
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
  else if (bytes.length >= 22 && bytes.readUInt32LE(0) === 0x04034b50) format = 'docx';
  else
    throw new AuthError(415, 'UNSUPPORTED_FORMAT', 'Only JPG, PNG and DOCX inputs are supported.');
  try {
    if (format === 'docx') validateDocx(bytes);
    else {
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
  } catch {
    throw new AuthError(
      422,
      'INVALID_FILE',
      'The file is malformed or exceeds safe resource limits.',
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
