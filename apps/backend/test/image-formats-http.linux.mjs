// Synthetic end-to-end acceptance against a dedicated disposable database only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
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
  throw new Error('An explicit owned image acceptance database is required.');
const servers = await infrastructureServers();
const environment = {
  ...process.env,
  NODE_ENV: 'test',
  API_HOST: '0.0.0.0',
  API_PORT: '3066',
  APP_ORIGIN: process.env.TEST_APP_ORIGIN ?? 'http://127.0.0.1:5173',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  REDIS_NAMESPACE: `images-${randomUUID()}`,
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
sharp.cache(false);
sharp.concurrency(1);
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
  const password = 'Owned-image-regression-password-2026';
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
  for (const entry of ['api', 'worker'])
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
  const fixtures = {
    svg: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="#208c5a" fill-opacity="0.5"/></svg>',
    ),
  };
  for (const source of ['jpg', 'png', 'webp', 'avif', 'gif'])
    fixtures[source] = await sharp({
      create: { width: 48, height: 32, channels: 4, background: '#208c5a80' },
    })
      .toFormat(source === 'jpg' ? 'jpeg' : source)
      .toBuffer();
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
        assert.equal(
          download.headers.get('content-type').split(';')[0],
          { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' }[output],
        );
        const result = Buffer.from(await download.arrayBuffer());
        assert.equal(result.length, job.result.sizeBytes);
        await sharp(result).raw().toBuffer();
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
  const guest = client();
  await mutation(guest, 'guest-session', {});
  const hostile = Buffer.from(
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + fixtures.svg.toString(),
  );
  assert.equal((await submit(guest, 'svg', hostile, 'png')).status, 422);
  const eligibility = await (await mutation(guest, 'guest-session', {})).json();
  assert.equal(eligibility.trialState, 'available');
  assert.equal((await submit(guest, 'png', fixtures.png, 'png')).status, 422);
  for (const format of ['gif', 'webp']) {
    const raw = Buffer.alloc(4 * 8 * 4);
    for (let offset = 0; offset < raw.length; offset += 4) {
      raw[offset + (offset < raw.length / 2 ? 0 : 2)] = 255;
      raw[offset + 3] = 255;
    }
    const animated = await sharp(raw, { raw: { width: 4, height: 8, pageHeight: 4, channels: 4 } })
      .toFormat(format, { delay: [100, 100], loop: 0 })
      .toBuffer();
    assert.equal((await sharp(animated).metadata()).pages, 2);
    assert.equal((await submit(guest, format, animated, 'png')).status, 422);
  }
  const sequence = Buffer.from(fixtures.avif);
  sequence.write('avis', 8, 'ascii');
  assert.equal((await submit(guest, 'avif', sequence, 'png')).status, 422);
  assert.equal((await (await mutation(guest, 'guest-session', {})).json()).trialState, 'available');
  const exact = Buffer.alloc(20_000_000);
  fixtures.png.copy(exact);
  assert.equal((await submit(account, 'png', exact, 'webp')).status, 202);
  assert.equal(
    (await submit(account, 'png', Buffer.concat([exact, Buffer.from([0])]), 'webp')).status,
    413,
  );
  console.log('PASS unsafe SVG and unsupported direction preserve guest eligibility');
  console.log(
    'PASS animated GIF/WebP/AVIF preserve guest eligibility; exact byte limit admitted, one byte over rejected',
  );
  if (process.env.BROWSER_QA === '1') {
    console.log('Image acceptance browser server ready on port 3066.');
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
