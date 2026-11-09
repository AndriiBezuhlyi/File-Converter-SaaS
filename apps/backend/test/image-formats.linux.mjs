import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
  ConversionEngine,
  sandboxArguments,
} from '../dist/worker/modules/conversions/conversion-engine.js';
import { CONVERSION_DIRECTIONS } from '../dist/worker/modules/conversions/conversion-policy.js';
import { validateUpload } from '../dist/api/modules/conversions/upload-validation.js';

if (process.platform !== 'linux') throw new Error('The bounded Linux sandbox is required.');
sharp.cache(false);
sharp.concurrency(1);
export const staticSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="#208c5a" fill-opacity="0.5"/></svg>';
export async function imageFixtures() {
  const fixtures = { svg: Buffer.from(staticSvg) };
  for (const format of ['jpg', 'png', 'webp', 'avif', 'gif']) {
    fixtures[format] = await sharp({
      create: { width: 48, height: 32, channels: 4, background: '#208c5a80' },
    })
      .toFormat(format === 'jpg' ? 'jpeg' : format)
      .toBuffer();
  }
  return fixtures;
}

test('all 20 image pairs pass admission, actual sandbox conversion, decoding and metadata privacy', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'imp06-matrix-'));
  const engine = new ConversionEngine();
  const fixtures = await imageFixtures();
  try {
    for (const [source, bytes] of Object.entries(fixtures)) {
      const path = join(directory, source);
      await writeFile(path, bytes);
      const reference = await sharp(bytes).ensureAlpha().raw().toBuffer();
      for (const target of CONVERSION_DIRECTIONS[source]) {
        const admitted = await validateUpload(
          { path, size: bytes.length, originalname: 'untrusted.exe' },
          { targetFormat: target },
        );
        assert.equal(admitted.format, source);
        const start = Date.now();
        const result = await engine.convert(path, source, target);
        const metadata = await sharp(result).metadata();
        assert.equal(
          metadata.format,
          target === 'jpg' ? 'jpeg' : target === 'avif' ? 'heif' : target,
        );
        assert.equal(metadata.width, 48);
        assert.equal(metadata.height, 32);
        assert.equal(metadata.exif, undefined);
        assert.equal(metadata.icc, undefined);
        assert.equal(metadata.xmp, undefined);
        assert.ok(result.length > 0 && result.length <= 40_000_000);
        await sharp(result).raw().toBuffer();
        const pixel = await sharp(result).ensureAlpha().raw().toBuffer();
        const alpha = reference[3] / 255;
        for (let channel = 0; channel < 3; channel++) {
          const expected =
            target === 'jpg' ? reference[channel] * alpha + 255 * (1 - alpha) : reference[channel];
          assert.ok(
            Math.abs(pixel[channel] - expected) <= 20,
            'Lossy output must preserve the fixture color.',
          );
        }
        assert.ok(Math.abs(pixel[3] - (target === 'jpg' ? 255 : reference[3])) <= 1);
        if (source === 'png' || source === 'svg') assert.equal(metadata.hasAlpha, target !== 'jpg');
        t.diagnostic(`${source}->${target}: ${result.length} bytes, ${Date.now() - start}ms`);
      }
      if (source !== 'gif' && source !== 'svg')
        await assert.rejects(engine.convert(path, source, source));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('animation, malformed bytes, dimensions and safe static SVG admission are enforced twice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imp06-invalid-'));
  const path = join(directory, 'input');
  const engine = new ConversionEngine();
  const reject = async (bytes, source) => {
    await writeFile(path, bytes);
    await assert.rejects(
      validateUpload(
        { path, size: bytes.length, originalname: `input.${source}` },
        { targetFormat: 'png' },
      ),
    );
    await assert.rejects(engine.convert(path, source, source === 'png' ? 'jpg' : 'png'));
  };
  try {
    for (const format of ['gif', 'webp']) {
      const raw = Buffer.alloc(4 * 8 * 4);
      for (let offset = 0; offset < raw.length; offset += 4) {
        raw[offset + (offset < raw.length / 2 ? 0 : 2)] = 255;
        raw[offset + 3] = 255;
      }
      const animated = await sharp(raw, {
        raw: { width: 4, height: 8, pageHeight: 4, channels: 4 },
      })
        .toFormat(format, { loop: 0, delay: [100, 100] })
        .toBuffer();
      assert.equal((await sharp(animated).metadata()).pages, 2);
      await reject(animated, format);
    }
    const fixtures = await imageFixtures();
    const frameCount = 1000;
    const frames = Buffer.alloc(2 * 2 * frameCount * 4);
    for (let offset = 0; offset < frames.length; offset += 4) {
      frames[offset + (Math.floor(offset / 16) % 2 ? 2 : 0)] = 255;
      frames[offset + 3] = 255;
    }
    const manyFrames = await sharp(frames, {
      raw: { width: 2, height: frameCount * 2, pageHeight: 2, channels: 4 },
    })
      .gif({ delay: Array(frameCount).fill(100), loop: 0 })
      .toBuffer();
    assert.equal((await sharp(manyFrames).metadata()).pages, frameCount);
    await reject(manyFrames, 'gif');
    await reject(fixtures.gif.subarray(0, 13), 'gif');
    await reject(fixtures.webp.subarray(0, 20), 'webp');
    const sequence = Buffer.from(fixtures.avif);
    sequence.write('avis', 8, 'ascii');
    await reject(sequence, 'avif');
    // Sequence boxes are rejected even if their brands are disguised as static AVIF.
    await reject(
      Buffer.concat([fixtures.avif, Buffer.from([0, 0, 0, 8, 109, 111, 111, 118])]),
      'avif',
    );
    await reject(fixtures.avif.subarray(0, 24), 'avif');
    for (const body of [
      '<script/>',
      '<image href="file:///etc/passwd"/>',
      '<image href="https://example.test/x"/>',
      '<style>@import "x";</style>',
    ]) {
      await reject(
        Buffer.from(
          staticSvg.replace(
            '<rect width="48" height="32" fill="#208c5a" fill-opacity="0.5"/>',
            body,
          ),
        ),
        'svg',
      );
    }
    await reject(
      Buffer.from('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + staticSvg),
      'svg',
    );
    await reject(
      Buffer.from(staticSvg.replace('width="48" height="32"', 'width="100000" height="100000"')),
      'svg',
    );
    await assert.rejects(
      validateUpload(
        { path, size: 20_000_001, originalname: 'input.svg' },
        { targetFormat: 'png' },
      ),
      { status: 413 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sandbox blocks inherited credentials, host file reads, network and oversized results', async () => {
  const engine = new ConversionEngine();
  const directory = await mkdtemp(join(tmpdir(), 'imp06-isolation-'));
  const sentinel = join(directory, 'host-only');
  await writeFile(sentinel, 'synthetic private sentinel');
  const run = (code) => {
    const args = sandboxArguments('/dev/null', 'jpg', 'png');
    args.splice(-3, 3, '-e', code);
    return engine.run(args);
  };
  try {
    const isolated = await run(
      `const fs=require('node:fs'); if(process.env.DATABASE_URL||process.env.SESSION_SECRET)process.exit(2);try{fs.readFileSync(${JSON.stringify(sentinel)});process.exit(3)}catch{};const s=require('node:net').connect({host:'127.0.0.1',port:5432});s.on('connect',()=>process.exit(4));s.on('error',()=>process.stdout.write('isolated'));s.setTimeout(1000,()=>{s.destroy();process.stdout.write('isolated')});`,
    );
    assert.equal(isolated.toString(), 'isolated');
    await assert.rejects(run('process.stdout.write(Buffer.alloc(40000001))'));
    assert.equal(await readFile(sentinel, 'utf8'), 'synthetic private sentinel');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('EXIF orientation, CMYK conversion and JPEG white alpha background remain compatible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imp06-colour-'));
  const path = join(directory, 'input');
  const engine = new ConversionEngine();
  try {
    await writeFile(
      path,
      await sharp({ create: { width: 2, height: 3, channels: 3, background: '#ff0000' } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    );
    for (const target of ['png', 'webp', 'avif']) {
      const metadata = await sharp(await engine.convert(path, 'jpg', target)).metadata();
      assert.equal(metadata.width, 3);
      assert.equal(metadata.height, 2);
      assert.equal(metadata.exif, undefined);
    }
    await writeFile(
      path,
      await sharp({ create: { width: 4, height: 3, channels: 3, background: '#ff0000' } })
        .toColourspace('cmyk')
        .jpeg()
        .toBuffer(),
    );
    assert.equal((await sharp(await readFile(path)).metadata()).space, 'cmyk');
    assert.equal((await sharp(await engine.convert(path, 'jpg', 'webp')).metadata()).space, 'srgb');
    await writeFile(
      path,
      await sharp({ create: { width: 4, height: 3, channels: 4, background: '#00000000' } })
        .png()
        .toBuffer(),
    );
    assert.ok(
      (
        await sharp(await engine.convert(path, 'png', 'jpg'))
          .raw()
          .toBuffer()
      ).every((value) => value > 245),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('exact byte and pixel limits are accepted and exceeding them is rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'imp06-boundary-'));
  const path = join(directory, 'input');
  const engine = new ConversionEngine();
  try {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();
    const exact = Buffer.alloc(20_000_000);
    png.copy(exact);
    await writeFile(path, exact);
    await validateUpload(
      { path, size: exact.length, originalname: 'input.png' },
      { targetFormat: 'webp' },
    );
    await engine.convert(path, 'png', 'webp');
    await assert.rejects(
      validateUpload(
        { path, size: 20_000_001, originalname: 'input.png' },
        { targetFormat: 'webp' },
      ),
      { status: 413 },
    );
    await writeFile(
      path,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="5000"/>'),
    );
    await engine.validateImage(path, 'svg');
    await writeFile(
      path,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8001" height="5000"/>'),
    );
    await assert.rejects(engine.validateImage(path, 'svg'));
    // A 10-bit static input is normalized to the approved 8-bit sRGB output.
    await writeFile(path, await sharp(png).avif({ bitdepth: 10 }).toBuffer());
    await engine.convert(path, 'avif', 'png');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
