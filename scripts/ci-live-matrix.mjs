import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';

if (process.platform !== 'linux') throw new Error('The live matrix requires a Linux Docker host.');
const root = resolve(import.meta.dirname, '..');
try {
  await access(resolve(root, '.env'));
  throw new Error('Refusing to run the CI harness in a checkout containing .env.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Refuse existing listeners before creating or migrating anything.
for (const port of [3000, 5173, 55432, 58025]) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}
const project = `flux-ci-${randomBytes(8).toString('hex')}`;
const environment = {
  ...process.env,
  CI_SESSION_SECRET: randomBytes(32).toString('hex'),
  CI_NOTIFICATION_KEY: randomBytes(32).toString('hex'),
};
const compose = [
  'compose',
  '--env-file',
  '/dev/null',
  '--project-name',
  project,
  '-f',
  resolve(root, 'infra/compose.ci.yaml'),
];
function run(command, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...environment, ...extra },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (${code}).`)),
    );
  });
}
let web;
try {
  await run('docker', [...compose, 'up', '-d', '--wait', 'postgres', 'redis', 'minio', 'mailpit']);
  await run('npm', ['run', 'db:migrate:deploy', '--workspace=@converter/backend'], {
    DATABASE_URL: 'postgresql://converter_test:local-test-only@127.0.0.1:55432/converter_test_ci',
  });
  await run('docker', [...compose, 'up', '-d', '--wait']);
  web = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js')], {
    cwd: resolve(root, 'apps/web'),
    env: environment,
    stdio: 'inherit',
  });
  web.once('error', () => {
    process.exitCode = 1;
  });
  await run(process.execPath, [
    'scripts/ci-wait-http.mjs',
    'http://127.0.0.1:5173/api/v1/health/ready',
  ]);
  await run(
    process.execPath,
    ['scripts/playwright.mjs', 'test', '--config', 'playwright.live.config.ts'],
    {
      CONVERTER_LIVE_E2E: '1',
      CONVERTER_ITEM17_ISOLATED: '1',
      CONVERTER_LIVE_MAIL_ORIGIN: 'http://127.0.0.1:58025',
    },
  );
} finally {
  web?.kill('SIGTERM');
  // Remove only this random project's disposable containers/network, including on failure.
  await run('docker', [...compose, 'down', '--volumes', '--remove-orphans']);
}
