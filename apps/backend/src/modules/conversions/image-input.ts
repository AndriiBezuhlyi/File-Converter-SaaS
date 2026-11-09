import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { MAX_IMAGE_PIXELS, MAX_UPLOAD_BYTES } from './conversion-policy.js';
import { validateSvg } from './svg-validation.js';

// Called only inside the credential-free Linux sandbox, before any raster decoder.
export async function validateImageInput(path: string, source: string) {
  const bytes = await readFile(path);
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error('Input limit.');
  if (source === 'svg') validateSvg(bytes);
  // HEIF sequence brands must be rejected even when a decoder exposes only the primary image.
  if (source === 'avif') {
    if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp')
      throw new Error('Invalid AVIF.');
    const size = bytes.readUInt32BE(0);
    if (size < 16 || size > bytes.length || size > 4096 || size % 4)
      throw new Error('Invalid AVIF.');
    const brands = [bytes.toString('ascii', 8, 12)];
    for (let offset = 16; offset < size; offset += 4)
      brands.push(bytes.toString('ascii', offset, offset + 4));
    if (!brands.includes('avif') || brands.includes('avis') || brands.includes('msf1'))
      throw new Error('Animated AVIF is unsupported.');
    for (let offset = 0; offset < bytes.length;) {
      if (offset + 8 > bytes.length) throw new Error('Truncated AVIF box.');
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      let length = bytes.readUInt32BE(offset);
      if (length === 1) {
        if (offset + 16 > bytes.length) throw new Error('Truncated AVIF box.');
        const large = bytes.readBigUInt64BE(offset + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('AVIF box limit.');
        length = Number(large);
        if (length < 16) throw new Error('Invalid AVIF box.');
      } else if (length === 0) length = bytes.length - offset;
      if (length < 8 || offset + length > bytes.length || type === 'moov')
        throw new Error('Malformed or animated AVIF.');
      offset += length;
    }
  }
  if (source === 'webp' && bytes.toString('ascii', 12, 16) === 'VP8X' && bytes[20]! & 2)
    throw new Error('Animated WebP is unsupported.');
  sharp.cache(false);
  sharp.concurrency(1);
  const metadata = await sharp(bytes, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    failOn: 'warning',
    density: 72,
  }).metadata();
  const expected = source === 'jpg' ? 'jpeg' : source === 'avif' ? 'heif' : source;
  if (
    metadata.format !== expected ||
    (source === 'avif' && metadata.compression !== 'av1') ||
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
    (metadata.pages ?? 1) !== 1 ||
    ((metadata.channels ?? 0) > 4 && metadata.space !== 'cmyk')
  )
    throw new Error('Malformed, animated or oversized image.');
  return metadata;
}
