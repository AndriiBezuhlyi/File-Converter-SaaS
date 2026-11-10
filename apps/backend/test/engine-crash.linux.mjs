import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, utimes, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CleanupService } from '../dist/worker/modules/files/cleanup.service.js';

if (process.platform !== 'linux') throw new Error('Real bounded Linux sandbox required.');

test('orchestrator SIGKILL kills sandbox descendants; aged scratch cleanup preserves active and unrelated paths', async () => {
  const root = await mkdtemp('/tmp/worker-crash-');
  const attempt = await mkdtemp(join(root, 'attempt-'));
  const active = await mkdtemp(join(root, 'attempt-'));
  const retained = join(root, 'retained');
  await mkdir(retained);
  const input = join(attempt, 'input');
  await writeFile(input, 'owned synthetic crash fixture');
  const marker = `flux${randomBytes(5).toString('hex')}`;
  const module = new URL('../dist/worker/modules/conversions/conversion-engine.js', import.meta.url)
    .href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import 'reflect-metadata';
    const { ConversionEngine, sandboxArguments } = await import(${JSON.stringify(module)});
    const args = sandboxArguments(${JSON.stringify(input)}, 'jpg', 'png');
    args.splice(-3, 3, '-e', ${JSON.stringify(`
      process.title = '${marker}';
      require('node:child_process').spawn(process.execPath, ['--jitless', '-e',
        "process.title = '${marker}'; setInterval(() => {}, 1000)"], { stdio: 'inherit' });
      setInterval(() => {}, 1000);
    `)});
    await new ConversionEngine().run(args);
  `,
    ],
    { env: {}, stdio: 'ignore' },
  );
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  async function processes() {
    const matches = [];
    for (const pid of (await readdir('/proc')).filter((name) => /^\d+$/.test(name))) {
      const name = await readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '');
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
      if (name.trim() === marker && !/\) Z /.test(stat)) matches.push(pid);
    }
    return matches;
  }
  async function until(check) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Crash isolation condition did not converge.');
  }
  try {
    await until(async () => (await processes()).length === 2);
    child.kill('SIGKILL');
    assert.equal((await exited).signal, 'SIGKILL');
    await until(async () => (await processes()).length === 0);
    assert.ok(
      (await readdir(attempt)).includes('input'),
      'Crash leaves scratch for scheduled cleanup.',
    );
    const old = new Date(Date.now() - 7_200_000);
    await utimes(attempt, old, old);
    await utimes(retained, old, old);
    // This filesystem-only operation uses no DB/storage adapter or relaxed limits.
    const cleanup = new CleanupService(undefined, undefined, { WORKER_TEMP_DIR: root });
    await cleanup.scratch();
    assert.deepEqual((await readdir(root)).sort(), [active.split('/').at(-1), 'retained'].sort());
  } finally {
    child.kill('SIGKILL');
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});
