import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  ConversionEngine,
  EngineFailure,
  sandboxArguments,
} from '../dist/worker/modules/conversions/conversion-engine.js';
import { zipEntries } from './fixtures/docx.ts';
sharp.concurrency(1);
sharp.cache(false);

if (process.platform !== 'linux')
  throw new Error('This test requires the Linux worker runtime and its sandbox.');

test('real sandbox: JPG to PNG orientation, PNG to JPG transparency, DOCX to PDF and malformed input', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'engine-test-'));
  const engine = new ConversionEngine();
  try {
    const input = join(directory, 'input');
    await writeFile(
      input,
      await sharp({ create: { width: 2, height: 3, channels: 3, background: '#ff0000' } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer(),
    );
    const png = await engine.convert(input, 'jpg', 'png');
    context.diagnostic('JPG to PNG completed.');
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 3);
    assert.equal(metadata.height, 2);
    await writeFile(
      input,
      await sharp({ create: { width: 3, height: 2, channels: 4, background: '#00000000' } })
        .png()
        .toBuffer(),
    );
    const jpg = await engine.convert(input, 'png', 'jpg');
    context.diagnostic('PNG to JPG completed.');
    const pixel = await sharp(jpg).raw().toBuffer();
    assert.ok(
      pixel.every((value) => value > 245),
      'Transparent pixels must become white.',
    );
    await writeFile(
      input,
      zipEntries({
        '[Content_Types].xml':
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels':
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml':
          '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Owned synthetic conversion fixture</w:t></w:r></w:p></w:body></w:document>',
      }),
    );
    const pdf = await engine.convert(input, 'docx', 'pdf');
    context.diagnostic('DOCX to PDF completed.');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.includes(Buffer.from('%%EOF')));
    await writeFile(input, Buffer.from('invalid synthetic data'));
    await assert.rejects(engine.convert(input, 'jpg', 'png'), EngineFailure);
  } finally {
    engine.beforeApplicationShutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test('sandbox hides service environment, other attempts and network, and applies kernel resource limits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'isolation-test-'));
  const input = join(directory, 'input');
  await writeFile(input, 'synthetic');
  const args = sandboxArguments(input, 'jpg', 'png');
  args.splice(
    -3,
    3,
    '-e',
    `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    assert.equal(process.env.SYNTHETIC_SERVICE_SECRET, undefined);
    assert.equal(fs.existsSync(${JSON.stringify(directory)}), false);
    assert.equal(fs.existsSync('/app/apps/backend'), false);
    assert.equal(fs.existsSync('/run'), false);
    assert.throws(() => fs.writeFileSync('/escape', 'synthetic'));
    assert.throws(() => fs.writeFileSync('/dev/escape', 'synthetic'));
    assert.ok(fs.readFileSync('/proc/self/limits','utf8').includes('40000000'));
    assert.ok(fs.readFileSync('/proc/self/net/route','utf8').trim().split('\\n').length <= 1);
    const chunk = Buffer.alloc(35000000);
    assert.throws(() => { for (let index = 0; index < 4; index++) fs.writeFileSync('/work/fill-' + index, chunk); }, { code: 'ENOSPC' });
  `,
  );
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/prlimit', args, {
        env: { SYNTHETIC_SERVICE_SECRET: 'owned-test-sentinel' },
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error('Sandbox isolation probe failed.')),
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'wall-clock deadline kills the complete sandbox process tree',
  { timeout: 70_000 },
  async () => {
    const engine = new ConversionEngine();
    const args = sandboxArguments('/dev/null', 'jpg', 'png');
    args.splice(
      -3,
      3,
      '-e',
      `
    require('node:child_process').spawn('/usr/local/bin/node', ['--jitless', '-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    setInterval(() => {}, 1000);
  `,
    );
    const started = Date.now();
    // Exercise the same runner used by convert, with a deliberately non-terminating synthetic engine.
    await assert.rejects(engine.run(args), EngineFailure);
    assert.ok(Date.now() - started >= 59_000);
    assert.ok(Date.now() - started < 65_000);
  },
);
