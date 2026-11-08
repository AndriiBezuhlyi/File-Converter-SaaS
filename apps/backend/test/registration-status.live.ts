import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { z } from 'zod';
import { ApiModule } from '../src/api.module.js';
import {
  INFRA_CONFIG,
  validateInfrastructureEnvironment,
} from '../src/infrastructure/config/infrastructure-config.js';
import { AUTH_CONFIG, validateAuthConfig } from '../src/modules/auth/auth-config.js';
import {
  NOTIFICATION_CONFIG,
  validateNotificationConfig,
} from '../src/modules/notifications/notification-config.js';
import { configureAuthApi } from '../src/modules/auth/configure-auth-api.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { RedisService } from '../src/infrastructure/redis/redis.service.js';
import { NotificationCipher } from '../src/modules/notifications/notification-cipher.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';

const database = process.env.TEST_DATABASE_URL;
const redis = process.env.TEST_REDIS_URL;
for (const [value, protocols, databaseTarget] of [
  [database, ['postgres:', 'postgresql:'], true],
  [redis, ['redis:'], false],
] as const) {
  let safe = false;
  try {
    const url = new URL(value ?? '');
    safe =
      protocols.some((protocol) => protocol === url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.search &&
      (!databaseTarget || /^\/converter_test(?:_[a-z0-9_]+)?$/.test(url.pathname));
  } catch {
    /* Never expose connection strings. */
  }
  if (!safe)
    throw new Error(
      'Explicit dedicated loopback TEST_DATABASE_URL and TEST_REDIS_URL are required.',
    );
}

describe('registration receipts with real PostgreSQL, Redis and cookie/CSRF sessions', () => {
  let app: NestExpressApplication;
  let servers: Awaited<ReturnType<typeof infrastructureServers>>;
  let db: DatabaseService;
  let cache: RedisService;
  let temporaryDirectory: string;
  const runId = randomUUID();
  const namespace = `registration-test-${runId}`;
  const email = `${runId}@example.test`;
  const otherEmail = `${runId}-other@example.test`;
  const origin = 'http://127.0.0.1:5173';
  const receiptSchema = z.object({
    status: z.literal('accepted'),
    registration: z.object({ receipt: z.string(), expiresAt: z.string() }),
  });
  beforeAll(async () => {
    servers = await infrastructureServers();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'flux-registration-test-'));
    const module = await Test.createTestingModule({ imports: [ApiModule.withAuthentication()] })
      .overrideProvider(INFRA_CONFIG)
      .useValue(
        validateInfrastructureEnvironment({
          NODE_ENV: 'test',
          DATABASE_URL: database,
          REDIS_URL: redis,
          REDIS_NAMESPACE: namespace,
          S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
          SMTP_PORT: servers.smtpPort,
          WORKER_TEMP_DIR: temporaryDirectory,
        }),
      )
      .overrideProvider(AUTH_CONFIG)
      .useValue(validateAuthConfig({ SESSION_SECRET: randomBytes(32).toString('hex') }))
      .overrideProvider(NOTIFICATION_CONFIG)
      .useValue(
        validateNotificationConfig({
          NODE_ENV: 'test',
          APP_ORIGIN: origin,
          NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        }),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    configureAuthApi(app);
    await app.init();
    db = app.get(DatabaseService);
    cache = app.get(RedisService);
  });
  afterAll(async () => {
    if (db) {
      const users = await db.client.user.findMany({
        where: { email: { in: [email, otherEmail] } },
        select: { id: true },
      });
      const ids = users.map((user) => user.id);
      const tokens = await db.client.verificationToken.findMany({
        where: { userId: { in: ids } },
        select: { id: true },
      });
      await db.client.backgroundTask.deleteMany({
        where: { type: 'email_notification', resourceId: { in: tokens.map((token) => token.id) } },
      });
      await db.client.user.deleteMany({ where: { id: { in: ids } } });
    }
    if (cache)
      for await (const keys of cache.client.scanIterator({ MATCH: `${namespace}:*`, COUNT: 100 }))
        if (keys.length) await cache.client.del(keys);
    await app?.close();
    await servers?.close();
    if (temporaryDirectory) {
      await unlink(join(temporaryDirectory, 'health.json')).catch(() => {});
      await rmdir(temporaryDirectory);
    }
  });

  it('confirms only the owned creation; handles second-device verification, replay, duplicate decoys, rotation and limits', async () => {
    const original = request.agent(app.getHttpServer());
    const other = request.agent(app.getHttpServer());
    const csrfSchema = z.object({ csrfToken: z.string() });
    const csrf = csrfSchema.parse(
      (await original.get('/api/v1/auth/csrf').expect(200)).body as unknown,
    ).csrfToken;
    const otherCsrf = csrfSchema.parse(
      (await other.get('/api/v1/auth/csrf').expect(200)).body as unknown,
    ).csrfToken;
    const post = (agent: typeof original, token: string, path: string, body: object) =>
      agent
        .post('/api/v1/auth/' + path)
        .set('Origin', origin)
        .set('X-CSRF-Token', token)
        .send(body);
    const registration = await post(original, csrf, 'register', {
      email,
      password: 'synthetic passphrase',
      trackStatus: true,
    }).expect(202);
    const { registration: receipt } = receiptSchema.parse(registration.body as unknown);
    const status = () => post(original, csrf, 'registration/status', { receipt: receipt.receipt });
    await status().expect(200).expect({ status: 'pending' });
    await post(other, otherCsrf, 'registration/status', { receipt: receipt.receipt })
      .expect(200)
      .expect({ status: 'expired' });
    await post(original, csrf, 'registration/status', {
      receipt: receipt.receipt,
      email: otherEmail,
    }).expect(400);
    const user = await db.client.user.findUniqueOrThrow({ where: { email } });
    const token = await db.client.verificationToken.findFirstOrThrow({
      where: { userId: user.id, purpose: 'email_verification', consumedAt: null },
    });
    const task = await db.client.backgroundTask.findUniqueOrThrow({
      where: { deduplicationKey: `email:${token.id}` },
    });
    const delivery = app.get(NotificationCipher).decrypt(task.id, task.payload);
    await post(other, otherCsrf, 'verify-email', { token: delivery.token }).expect(204);
    await status().expect(200).expect({ status: 'verified' });
    await post(other, otherCsrf, 'verify-email', { token: delivery.token }).expect(400);
    await status().expect(200).expect({ status: 'verified' });
    await original.get('/api/v1/auth/session').expect(200).expect({ kind: 'anonymous' });
    const duplicate = receiptSchema.parse(
      (
        await post(original, csrf, 'register', {
          email,
          password: 'different synthetic passphrase',
          trackStatus: true,
        }).expect(202)
      ).body as unknown,
    ).registration;
    await post(original, csrf, 'registration/status', { receipt: duplicate.receipt })
      .expect(200)
      .expect({ status: 'pending' });
    const next = receiptSchema.parse(
      (
        await post(original, csrf, 'register', {
          email: otherEmail,
          password: 'another synthetic passphrase',
          trackStatus: true,
        }).expect(202)
      ).body as unknown,
    ).registration;
    await post(original, csrf, 'registration/status', { receipt: next.receipt })
      .expect(200)
      .expect({ status: 'pending' });
    await status().expect(200).expect({ status: 'verified' });
    await db.client.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    await status().expect(200).expect({ status: 'expired' });
    let limited = false;
    for (let i = 0; i < 31; i++) {
      const response = await status();
      if (response.status === 429) {
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
        limited = true;
        break;
      }
      expect(response.status).toBe(200);
    }
    expect(limited).toBe(true);
    await post(original, csrf, 'logout', {}).expect(204);
    const fresh = csrfSchema.parse(
      (await original.get('/api/v1/auth/csrf').expect(200)).body as unknown,
    ).csrfToken;
    await post(original, fresh, 'registration/status', { receipt: next.receipt })
      .expect(200)
      .expect({ status: 'expired' });
  });
});
