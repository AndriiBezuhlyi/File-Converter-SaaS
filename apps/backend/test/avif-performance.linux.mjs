import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ConversionEngine } from '../dist/worker/modules/conversions/conversion-engine.js';

if (process.platform !== 'linux') throw new Error('The bounded Linux sandbox is required.');
sharp.cache(false);
sharp.concurrency(1);

test('audit 6 MP JPG converts to decodable AVIF within the existing sandbox budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'avif-performance-'));
  const engine = new ConversionEngine();
  try {
    // Exact input generator from the 2026-11-13 WebPerf audit.
    const raw = Buffer.alloc(3000 * 2000 * 3);
    let seed = 123456789;
    for (let index = 0; index < raw.length; index++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      raw[index] = seed & 255;
    }
    const input = join(directory, 'input.jpg');
    await writeFile(
      input,
      await sharp(raw, { raw: { width: 3000, height: 2000, channels: 3 } })
        .jpeg({ quality: 90 })
        .toBuffer(),
    );
    // convert() retains the production cgroup guards, CPU limit and deadline.
    const result = await engine.convert(input, 'jpg', 'avif');
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.format, 'heif');
    assert.equal(metadata.compression, 'av1');
    assert.equal(metadata.width, 3000);
    assert.equal(metadata.height, 2000);
    assert.equal(metadata.bitsPerSample, 8);
    assert.equal(metadata.exif, undefined);
    assert.equal((await sharp(result).raw().toBuffer()).length, 3000 * 2000 * 3);
  } finally {
    engine.beforeApplicationShutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
