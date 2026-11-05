// Owned local acceptance harness. Never point this at a shared or production database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { infrastructureServers } from './fixtures/infrastructure-servers.ts';
import { zipEntries } from './fixtures/docx.ts';
import { DatabaseService } from '../dist/api/infrastructure/database/database.service.js';
import { validateInfrastructureEnvironment } from '../dist/api/infrastructure/config/infrastructure-config.js';
import { PasswordService } from '../dist/api/modules/auth/password.service.js';

if (process.platform !== 'linux') throw new Error('Linux worker runtime required.');
const databaseUrl = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (
  !['127.0.0.1', 'host.docker.internal'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/converter_test_item15'
)
  throw new Error('Owned item15 test database required.');
const servers = await infrastructureServers();
const environment = {
  ...process.env,
  NODE_ENV: 'test',
  API_HOST: '0.0.0.0',
  API_PORT: '3000',
  APP_ORIGIN: 'http://127.0.0.1:5173',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  REDIS_NAMESPACE: `http-${randomBytes(8).toString('hex')}`,
  S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
  SMTP_PORT: String(servers.smtpPort),
  WORKER_TEMP_DIR: '/tmp/converter-http-test',
};
const config = validateInfrastructureEnvironment(environment);
const db = new DatabaseService(config);
const processes = [];
let user;
let stop;
const stopped = new Promise((resolve) => {
  stop = resolve;
});
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
const base = 'http://127.0.0.1:3000/api/v1/';
async function waitFor(check) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      /* Readiness polling. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Acceptance readiness deadline exceeded.');
}
let cookies = '';
async function json(path, body) {
  const headers = { Cookie: cookies, Origin: environment.APP_ORIGIN };
  if (body !== undefined) {
    const csrf = await json('auth/csrf');
    headers['X-CSRF-Token'] = csrf.csrfToken;
    headers.Cookie = cookies;
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(base + path, {
    headers,
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const name = pair.split('=')[0];
    cookies = [
      ...cookies.split('; ').filter((entry) => entry && !entry.startsWith(name + '=')),
      pair,
    ].join('; ');
  }
  assert.ok(response.ok, `HTTP ${response.status} on ${path}`);
  return response.status === 204 ? null : response.json();
}
try {
  await db.start();
  user = await db.client.user.create({
    data: {
      email: 'browser-item15@example.test',
      passwordHash: await new PasswordService().hash('Owned-item15-password-2026'),
      emailVerifiedAt: new Date(),
      settings: { create: { autoSave: true } },
    },
  });
  // Generate image fixtures in a short-lived process so its native thread pools do not share the worker's PID budget.
  const jpg = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import sharp from 'sharp'; process.stdout.write(await sharp({create:{width:3,height:4,channels:3,background:'#f00'}}).jpeg().toBuffer());",
  ]);
  const png = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import sharp from 'sharp'; process.stdout.write(await sharp({create:{width:3,height:4,channels:4,background:'#00000000'}}).png().toBuffer());",
  ]);
  const docx = zipEntries({
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Owned synthetic fixture</w:t></w:r></w:p></w:body></w:document>',
  });
  for (const entry of ['api', 'worker'])
    processes.push(
      spawn(process.execPath, [`dist/${entry}/entrypoints/${entry}.main.js`], {
        env: environment,
        stdio: 'inherit',
      }),
    );
  await waitFor(async () => (await fetch(base + 'health/ready')).ok);
  await waitFor(
    async () => JSON.parse(await readFile('/tmp/converter-http-test/health.json', 'utf8')).ready,
  );
  await json('auth/login', { email: user.email, password: 'Owned-item15-password-2026' });
  for (const [source, target, bytes, magic] of [
    ['jpg', 'png', jpg, [137, 80, 78, 71]],
    ['png', 'jpg', png, [255, 216, 255]],
    ['docx', 'pdf', docx, [37, 80, 68, 70, 45]],
  ]) {
    const csrf = await json('auth/csrf');
    const form = new FormData();
    form.append('file', new Blob([bytes]), `synthetic.${source}`);
    form.append('targetFormat', target);
    const response = await fetch(base + 'conversions', {
      method: 'POST',
      headers: { Cookie: cookies, Origin: environment.APP_ORIGIN, 'X-CSRF-Token': csrf.csrfToken },
      body: form,
    });
    assert.equal(response.status, 202);
    const accepted = await response.json();
    const job = await waitFor(async () => {
      const job = await json(`conversions/${accepted.id}`);
      assert.notEqual(job.status, 'failed', `Real ${source} to ${target} failed.`);
      return job.status === 'completed' ? job : false;
    });
    assert.equal(job.result.retention, 'saved');
    assert.equal(job.result.owner, 'account');
    const download = await fetch(base + `conversions/${accepted.id}/download`, {
      headers: { Cookie: cookies },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('cache-control'), 'no-store');
    const result = Buffer.from(await download.arrayBuffer());
    assert.deepEqual([...result.subarray(0, magic.length)], magic);
    assert.equal(result.length, job.result.sizeBytes);
    const denied = await fetch(base + `conversions/${accepted.id}/download`);
    assert.equal(denied.status, 401);
    console.log(
      `Real HTTP ${source} to ${target}: completed, saved and downloaded; unauthenticated access denied.`,
    );
  }
  console.log('Real API/worker acceptance passed.');
  if (process.env.BROWSER_QA === '1') {
    console.log('Browser QA fixture ready at port 3000.');
    await stopped;
  }
} finally {
  for (const child of processes) child.kill('SIGTERM');
  await Promise.all(
    processes.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once('exit', resolve);
          const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
          timer.unref();
        }),
    ),
  );
  if (user) {
    const conversions = await db.client.conversion.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const files = await db.client.file.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    await db.client.backgroundTask.deleteMany({
      where: { resourceId: { in: [...conversions, ...files].map((item) => item.id) } },
    });
    await db.client.conversion.deleteMany({ where: { userId: user.id } });
    await db.client.file.deleteMany({ where: { userId: user.id } });
    await db.client.user.delete({ where: { id: user.id } });
  }
  await db.stop();
  await servers.close();
}
