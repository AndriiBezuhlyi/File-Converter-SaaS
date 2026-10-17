import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const target = process.argv[2];
if (!['api', 'worker'].includes(target)) throw new Error('Expected api or worker.');
const backend = fileURLToPath(new URL('../apps/backend/', import.meta.url));
const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const entry = fileURLToPath(
  new URL(
    '../apps/backend/dist/' + target + '/entrypoints/' + target + '.main.js',
    import.meta.url,
  ),
);
let application;
let compilation;
let timer;
let building = false;
let queued = false;
let stopping = false;

async function stopApplication() {
  if (!application || application.exitCode !== null || application.signalCode !== null) return;
  const exited = once(application, 'exit');
  application.kill('SIGTERM');
  const deadline = setTimeout(() => application?.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(deadline);
  }
}

async function rebuild() {
  if (stopping) return;
  if (building) {
    queued = true;
    return;
  }
  building = true;
  try {
    await stopApplication();
    compilation = spawn(process.execPath, [compiler, '-p', 'tsconfig.' + target + '.json'], {
      cwd: backend,
      stdio: 'inherit',
    });
    const [code] = await once(compilation, 'exit');
    if (code === 0 && !stopping) {
      application = spawn(process.execPath, [entry], {
        cwd: backend,
        stdio: 'inherit',
        env: process.env,
      });
    }
  } finally {
    building = false;
    if (queued && !stopping) {
      queued = false;
      void rebuild();
    }
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void rebuild().catch(fail);
  }, 200);
}

function fail() {
  console.error('Backend development process failed.');
  process.exitCode = 1;
  shutdown();
}

const watchers = [
  watch(new URL('../apps/backend/src/', import.meta.url), { recursive: true }, schedule),
  ...[
    'tsconfig.base.json',
    'apps/backend/tsconfig.json',
    'apps/backend/tsconfig.' + target + '.json',
  ].map((path) => watch(new URL('../' + path, import.meta.url), schedule)),
];

function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  watchers.forEach((watcher) => watcher.close());
  compilation?.kill('SIGTERM');
  void stopApplication().catch(() => {
    process.exitCode = 1;
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
await rebuild();
