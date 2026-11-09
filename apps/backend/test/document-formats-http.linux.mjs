// Synthetic end-to-end acceptance against a dedicated disposable database only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { documentFixtures, documentText, officeEntries } from './fixtures/documents.mjs';
import { zipEntries } from './fixtures/docx.ts';
import { execFileSync } from 'node:child_process';
import { infrastructureServers } from './fixtures/infrastructure-servers.ts';
import { DatabaseService } from '../dist/api/infrastructure/database/database.service.js';
import { validateInfrastructureEnvironment } from '../dist/api/infrastructure/config/infrastructure-config.js';
import { PasswordService } from '../dist/api/modules/auth/password.service.js';
import { CONVERSION_DIRECTIONS } from '../dist/worker/modules/conversions/conversion-policy.js';

const target = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (
  process.platform !== 'linux' ||
  !['host.docker.internal', '127.0.0.1'].includes(target.hostname) ||
  !/^\/converter_test_imp06_[a-z0-9_]+$/.test(target.pathname)
)
  throw new Error('An explicit owned document acceptance database is required.');
const servers = await infrastructureServers();
const environment = {
  ...process.env,
  NODE_ENV: 'test',
  API_HOST: '0.0.0.0',
  API_PORT: '3066',
  APP_ORIGIN: process.env.TEST_APP_ORIGIN ?? 'http://127.0.0.1:5173',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  REDIS_NAMESPACE: `documents-${randomUUID()}`,
  S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
  SMTP_PORT: String(servers.smtpPort),
  WORKER_TEMP_DIR: '/tmp/imp06-http',
  AUTH_TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
};
const db = new DatabaseService(validateInfrastructureEnvironment(environment));
const processes = [];
const base = 'http://127.0.0.1:3066/api/v1/';
const prefix = 'fc_' + randomBytes(12).toString('hex');
let apiKey = prefix + '.' + randomBytes(32).toString('base64url');

const waitFor = async (check) => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await check().catch(() => false);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Acceptance deadline exceeded.');
};
let nextIp = 10;
const client = () => ({ cookies: '', ip: `198.51.100.${nextIp++}` });
async function call(ctx, path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { Cookie: ctx.cookies, 'X-Forwarded-For': ctx.ip, ...options.headers },
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0],
      name = pair.split('=')[0];
    ctx.cookies = [
      ...ctx.cookies.split('; ').filter((value) => value && !value.startsWith(name + '=')),
      pair,
    ].join('; ');
  }
  return response;
}
async function mutation(ctx, path, body) {
  const csrf = await (await call(ctx, 'auth/csrf')).json();
  return call(ctx, path, {
    method: 'POST',
    headers: {
      Origin: environment.APP_ORIGIN,
      'X-CSRF-Token': csrf.csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
async function submit(ctx, source, bytes, targetFormat, key = false) {
  const headers = key
    ? { 'X-API-Key': apiKey }
    : {
        Origin: environment.APP_ORIGIN,
        'X-CSRF-Token': (await (await call(ctx, 'auth/csrf')).json()).csrfToken,
      };
  const body = new FormData();
  body.append('file', new Blob([bytes]), `synthetic.${source}`);
  body.append('targetFormat', targetFormat);
  return call(ctx, 'conversions', { method: 'POST', headers, body });
}
try {
  await db.start();
  const password = 'Owned-document-regression-password-2026';
  const user = await db.client.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      passwordHash: await new PasswordService().hash(password),
      emailVerifiedAt: new Date(),
      settings: { create: { autoSave: true } },
    },
  });
  await db.client.apiKey.create({
    data: {
      userId: user.id,
      secretHash: createHash('sha256').update(apiKey).digest('hex'),
      prefix,
    },
  });
  for (const entry of ['api', 'worker', 'worker'])
    processes.push(
      spawn(process.execPath, [`dist/${entry}/entrypoints/${entry}.main.js`], {
        env: environment,
        stdio: ['ignore', 'ignore', 'inherit'],
      }),
    );
  await waitFor(async () => (await fetch(base + 'health/ready')).ok);
  let account = client();
  assert.equal(
    (await mutation(account, 'auth/login', { email: user.email, password })).status,
    200,
  );
  const fixtures = documentFixtures();
  const capabilities = await (await fetch(base + 'capabilities')).json();
  assert.deepEqual(capabilities.directions, CONVERSION_DIRECTIONS);
  for (const mode of ['account', 'key', 'guest']) {
    for (const [source, bytes] of Object.entries(fixtures))
      for (const output of CONVERSION_DIRECTIONS[source]) {
        if (mode !== 'guest') {
          // Independent synthetic identities keep the production per-principal rate limit intact.
          const owned = await db.client.user.create({
            data: {
              email: `${randomUUID()}@example.test`,
              passwordHash: user.passwordHash,
              emailVerifiedAt: new Date(),
              settings: { create: { autoSave: true } },
            },
          });
          const keyPrefix = 'fc_' + randomBytes(12).toString('hex');
          apiKey = keyPrefix + '.' + randomBytes(32).toString('base64url');
          await db.client.apiKey.create({
            data: {
              userId: owned.id,
              prefix: keyPrefix,
              secretHash: createHash('sha256').update(apiKey).digest('hex'),
            },
          });
          account = client();
          assert.equal(
            (await mutation(account, 'auth/login', { email: owned.email, password })).status,
            200,
          );
        }
        const ctx = mode === 'guest' ? client() : account;
        if (mode === 'guest') assert.equal((await mutation(ctx, 'guest-session', {})).status, 200);
        const headers = mode === 'key' ? { 'X-API-Key': apiKey } : {};
        const response = await submit(ctx, source, bytes, output, mode === 'key');
        assert.equal(
          response.status,
          202,
          `${mode} ${source}->${output}: admission ${response.status}`,
        );
        const accepted = await response.json();
        let failure;
        const job = await waitFor(async () => {
          const state = await (await call(ctx, `conversions/${accepted.id}`, { headers })).json();
          if (state.status === 'failed') {
            failure = state;
            return state;
          }
          return state.status === 'completed' ? state : false;
        });
        assert.equal(failure, undefined, `${mode} ${source}->${output}: engine failure`);
        assert.equal(job.result.format, output);
        assert.equal(job.result.retention, mode === 'guest' ? 'temporary' : 'saved');
        const download = await call(ctx, `conversions/${job.id}/download`, { headers });
        assert.equal(download.status, 200);
        assert.equal(download.headers.get('cache-control'), 'no-store');
        assert.equal(download.headers.get('content-type').split(';')[0], 'application/pdf');
        const result = Buffer.from(await download.arrayBuffer());
        assert.equal(result.length, job.result.sizeBytes);
        assert.equal(result.subarray(0, 5).toString(), '%PDF-');
        const text = execFileSync('pdftotext', ['-', '-'], { input: result, encoding: 'utf8' });
        assert.ok(text.includes(documentText), source + ': PDF content');
        assert.equal((await fetch(base + `conversions/${job.id}/download`)).status, 401);
        if (mode !== 'guest') {
          const listing = await (
            await call(ctx, `files?format=${output}&limit=100`, { headers })
          ).json();
          assert.ok(
            listing.items.some((file) => file.id === job.result.id),
            'Saved output must be filterable.',
          );
          const file = await call(ctx, `files/${job.result.id}/download`, { headers });
          assert.equal(file.status, 200);
          assert.deepEqual(Buffer.from(await file.arrayBuffer()), result);
        } else {
          assert.equal((await submit(ctx, source, bytes, output)).status, 401);
        }
        console.log(
          `PASS ${mode} ${source}->${output}: admitted, processed, polled, downloaded, ownership and retention`,
        );
      }
  }
  const concurrent = await Promise.all(
    ['txt', 'csv'].map(async (source) => {
      const marker = `${source.toUpperCase()}_WORKER_SENTINEL`;
      const bytes = Buffer.from(
        fixtures[source].toString('utf8').trimEnd() +
          (source === 'csv' ? `\nConcurrent,${marker}` : `\n${marker}`),
      );
      const response = await submit(account, source, bytes, 'pdf');
      assert.equal(response.status, 202);
      return { source, marker, id: (await response.json()).id };
    }),
  );
  let overlap = false;
  await waitFor(async () => {
    const jobs = await db.client.conversion.findMany({
      where: { id: { in: concurrent.map((j) => j.id) } },
    });
    if (jobs.filter((j) => j.status === 'processing').length === 2) overlap = true;
    assert.ok(jobs.every((j) => j.status !== 'failed'));
    return jobs.length === 2 && jobs.every((j) => j.status === 'completed');
  });
  assert.ok(overlap, 'two concurrency-1 worker processes must overlap');
  for (const job of concurrent) {
    const response = await call(account, `conversions/${job.id}/download`);
    assert.equal(response.status, 200);
    const text = execFileSync('pdftotext', ['-', '-'], {
      input: Buffer.from(await response.arrayBuffer()),
      encoding: 'utf8',
    });
    assert.ok(text.includes(job.marker));
    assert.ok(!text.includes(job.source === 'csv' ? 'TXT_WORKER_SENTINEL' : 'CSV_WORKER_SENTINEL'));
  }
  console.log(
    'PASS concurrent requests overlap across two real workers with isolated document profiles/content',
  );
  for (const [source, bytes] of [
    ['csv', Buffer.from('a;b\n1;2')],
    ['csv', Buffer.from('a,b\n"broken')],
    ['txt', Buffer.from([0xff, 0xfe, 65, 0])],
    ['xlsx', zipEntries({ ...officeEntries('xlsx'), 'xl/vbaProject.bin': 'synthetic' })],
    [
      'pptx',
      zipEntries({
        ...officeEntries('pptx'),
        'outside.xml': '<x href="https://example.test/resource"/>',
      }),
    ],
    ['odt', Buffer.from('PK\u0000malformed')],
  ]) {
    const ctx = client();
    await mutation(ctx, 'guest-session', {});
    assert.ok([415, 422].includes((await submit(ctx, source, bytes, 'pdf')).status));
    assert.equal((await (await mutation(ctx, 'guest-session', {})).json()).trialState, 'available');
  }
  console.log('PASS document security rejections preserve guest eligibility');
  if (process.env.BROWSER_QA === '1') {
    console.log('Document acceptance browser server ready on port 3066.');
    await new Promise((resolve) => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
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
  await db.stop();
  await servers.close();
}
