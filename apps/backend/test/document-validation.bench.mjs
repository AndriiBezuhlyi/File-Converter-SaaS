// Run after build:api. Optional argument: an equivalent baseline API build directory.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import zlib from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import { documentArchive, zipEntries } from './fixtures/docx.ts';
import { documentFixtures } from './fixtures/documents.mjs';

let inflations = 0;
const inflate = zlib.inflateRawSync;
zlib.inflateRawSync = (...args) => {
  inflations++;
  return inflate(...args);
};
syncBuiltinESMExports();
const root = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]) + '/')
  : new URL('../dist/api/', import.meta.url);
const { validateUpload } = await import(new URL('modules/conversions/upload-validation.js', root));
const text = Buffer.alloc(8_000_000);
let seed = 13579;
for (let i = 0; i < text.length; i++) {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  text[i] = 97 + ((seed >>> 0) % 26);
}
const large = documentArchive({
  'word/document.xml':
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' +
    text.toString() +
    '</w:t></w:r></w:p></w:body></w:document>',
});
const fixtures = Object.entries(documentFixtures()).map(([name, bytes]) => ({
  name,
  bytes,
  valid: true,
}));
fixtures.push({ name: 'audit-large-docx', bytes: large, valid: true });
for (const [name, extra] of Object.entries({
  traversal: { '../escape.xml': '<test/>' },
  macro: { 'word/vbaProject.bin': 'macro' },
  embedded: { 'word/embeddings/program.exe': 'program' },
  external: {
    'word/_rels/document.xml.rels':
      '<Relationship TargetMode="External" Target="https://example.test"/>',
  },
  doctype: { 'word/document.xml': '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><document/>' },
  expansion: { 'word/huge.xml': 'x'.repeat(100_000) },
  invalidMain: { 'word/document.xml': '<wrong/>' },
}))
  fixtures.push({ name, bytes: documentArchive(extra), valid: false });
fixtures.push({ name: 'truncated', bytes: large.subarray(0, -1), valid: false });
const corrupt = documentArchive();
corrupt[35] ^= 255;
fixtures.push({ name: 'checksum', bytes: corrupt, valid: false });
fixtures.push({
  name: 'entry-limit',
  bytes: zipEntries(
    Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`part${i}.txt`, 'x'])),
  ),
  valid: false,
});
const directory = await mkdtemp(join(tmpdir(), 'f04-bench-'));
console.log(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    samples: 7,
    root: root.href,
    note: 'Full admission including readFile; peakRSS is process lifetime high-water mark in KiB, not per-operation allocation.',
  }),
);
try {
  for (const { name, bytes, valid } of fixtures) {
    const path = join(directory, name);
    await writeFile(path, bytes);
    for (let sample = 0; sample < 8; sample++) {
      global.gc?.();
      const histogram = monitorEventLoopDelay({ resolution: 1 });
      histogram.enable();
      await delay(20);
      inflations = 0;
      const cpuStart = process.cpuUsage();
      const start = performance.now();
      let accepted = true;
      try {
        await validateUpload(
          { path, size: bytes.length, originalname: `synthetic.${name}` },
          { targetFormat: 'pdf' },
        );
      } catch (error) {
        assert.equal(error.getResponse().error.code, 'INVALID_FILE');
        accepted = false;
      }
      const wallMs = performance.now() - start;
      const cpu = process.cpuUsage(cpuStart);
      await delay(10);
      histogram.disable();
      assert.equal(accepted, valid, name);
      if (sample)
        console.log(
          JSON.stringify({
            name,
            sample,
            bytes: bytes.length,
            accepted,
            wallMs,
            cpuMs: (cpu.user + cpu.system) / 1000,
            eventLoopMaxMs: histogram.max / 1e6,
            peakRssKiB: process.resourceUsage().maxRSS,
            rss: process.memoryUsage().rss,
            inflations,
          }),
        );
    }
  }
} finally {
  zlib.inflateRawSync = inflate;
  syncBuiltinESMExports();
  await rm(directory, { recursive: true });
}
