import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { INestApplicationContext } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Response } from 'express';
import request from 'supertest';
import { ApiModule } from '../src/api.module.js';
import { WorkerModule } from '../src/worker.module.js';
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
import { EmailService } from '../src/infrastructure/email/email.service.js';
import { NotificationCipher } from '../src/modules/notifications/notification-cipher.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { NotificationWorker } from '../src/modules/notifications/notification-worker.js';
import { RateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { RevocableSessionStore } from '../src/infrastructure/sessions/revocable-session.store.js';
import { AccountRepository } from '../src/modules/auth/account.repository.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { Cookie, type SessionData } from 'express-session';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';

const database = process.env.TEST_DATABASE_URL;
const redis = process.env.TEST_REDIS_URL;
if (!database || !redis)
  throw new Error('Explicit TEST_DATABASE_URL and TEST_REDIS_URL are required.');
for (const { value, protocols, isDatabase } of [
  { value: database, protocols: ['postgres:', 'postgresql:'], isDatabase: true },
  { value: redis, protocols: ['redis:'], isDatabase: false },
]) {
  let valid = false;
  try {
    const url = new URL(value);
    valid =
      protocols.includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.search &&
      (!isDatabase || /^\/converter_test(?:_[a-z0-9_]+)?$/.test(url.pathname));
  } catch {
    /* Never include rejected targets in errors. */
  }
  if (!valid) throw new Error('Auth tests require dedicated loopback test services.');
}

describe('real PostgreSQL/Redis auth and notification delivery', () => {
  let app: NestExpressApplication<Server>;
  let worker: INestApplicationContext | undefined;
  let servers: Awaited<ReturnType<typeof infrastructureServers>>;
  let db: DatabaseService;
  let cache: RedisService;
  let cipher: NotificationCipher;
  const runId = randomUUID();
  const email = `${runId}@example.test`;
  const nextEmail = `${runId}-changed@example.test`;
  const origin = 'http://127.0.0.1:5173';
  const password = '1234567890';
  const newPassword = '1234567890 changed';
  const auth = validateAuthConfig({
    SESSION_SECRET: randomBytes(32).toString('hex'),
    AUTH_TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
  });
  const notification = validateNotificationConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: origin,
    NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  });
  let config: ReturnType<typeof validateInfrastructureEnvironment>;
  let temporaryDirectory: string;
  let userId: string;
  let sid: string;
  let csrf: string;
  let otherSid: string;
  let bootstrapAttempted = false;

  beforeEach(() => {
    if (bootstrapAttempted && !userId)
      throw new Error('Owned synthetic account was not initialized.');
    bootstrapAttempted = true;
  });

  const api = () => request(app.getHttpServer());
  const post = (path: string, body: object, cookie = sid, token = csrf) =>
    api()
      .post('/api/v1' + path)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send(body);
  const cookie = (response: request.Response) => {
    const header: unknown = response.headers['set-cookie'];
    if (!Array.isArray(header) || typeof header[0] !== 'string')
      throw new Error('Expected session cookie.');
    return header[0].split(';')[0]!;
  };
  const tokenFrom = (response: request.Response) => {
    const body: unknown = response.body;
    if (
      !body ||
      typeof body !== 'object' ||
      !('csrfToken' in body) ||
      typeof body.csrfToken !== 'string'
    )
      throw new Error('Expected CSRF token.');
    return body.csrfToken;
  };
  const bootstrap = async (existing?: string) => {
    const response = await (
      existing
        ? api().get('/api/v1/auth/csrf').set('Cookie', existing)
        : api().get('/api/v1/auth/csrf')
    ).expect(200);
    return { sid: cookie(response), csrf: tokenFrom(response) };
  };
  const link = async (purpose: 'email_verification' | 'password_reset' | 'email_change') => {
    const token = await db.client.verificationToken.findFirstOrThrow({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const task = await db.client.backgroundTask.findUniqueOrThrow({
      where: { deduplicationKey: `email:${token.id}` },
    });
    const delivery = cipher.decrypt(task.id, task.payload);
    expect(token.tokenHash).not.toBe(delivery.token);
    expect(JSON.stringify(task.payload)).not.toContain(delivery.token);
    return { token: delivery.token, task };
  };
  const eventually = async (predicate: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 10_000;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error('Expected notification state was not reached.');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    servers = await infrastructureServers();
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'converter-auth-test-'));
    config = validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: database,
      REDIS_URL: redis,
      REDIS_NAMESPACE: `auth-test-${runId}`,
      S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
      SMTP_PORT: servers.smtpPort,
      WORKER_TEMP_DIR: temporaryDirectory,
    });
    const module = await Test.createTestingModule({ imports: [ApiModule.withAuthentication()] })
      .overrideProvider(INFRA_CONFIG)
      .useValue(config)
      .overrideProvider(AUTH_CONFIG)
      .useValue(auth)
      .overrideProvider(NOTIFICATION_CONFIG)
      .useValue(notification)
      .compile();
    app = module.createNestApplication<NestExpressApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    configureAuthApi(app);
    await app.init();
    db = app.get(DatabaseService);
    cache = app.get(RedisService);
    cipher = app.get(NotificationCipher);
  });
  afterAll(async () => {
    await worker?.close();
    if (db) {
      const users = await db.client.user.findMany({
        where: { email: { in: [email, nextEmail] } },
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
    if (cache) {
      for await (const keys of cache.client.scanIterator({
        MATCH: `${config.REDIS_NAMESPACE}:*`,
        COUNT: 100,
      }))
        if (keys.length) await cache.client.del(keys);
    }
    await app?.close();
    await servers?.close();
    if (temporaryDirectory) {
      await unlink(join(temporaryDirectory, 'health.json')).catch(() => {});
      await rmdir(temporaryDirectory);
    }
  });

  it('bootstraps a protected anonymous context, registers atomically, and denies unverified login', async () => {
    ({ sid, csrf } = await bootstrap());
    expect(sid).toMatch(/^converter\.dev\.sid=/);
    await post('/auth/register', { email, password }).expect(202);
    const user = await db.client.user.findUniqueOrThrow({ where: { email } });
    userId = user.id;
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await db.client.userSettings.findUnique({ where: { userId } })).toMatchObject({
      autoSave: false,
    });
    await post('/auth/login', { email, password }).expect(403).expect('Cache-Control', 'no-store');
    await post('/auth/login', { email, password: 'wrong' }).expect(401);
  });

  it('dispatches only notification task IDs through BullMQ and sends a single-use fragment link via SMTP', async () => {
    const verification = await link('email_verification');
    const module = await Test.createTestingModule({ imports: [WorkerModule.withNotifications()] })
      .overrideProvider(INFRA_CONFIG)
      .useValue(config)
      .overrideProvider(NOTIFICATION_CONFIG)
      .useValue(notification)
      .compile();
    worker = await module.init();
    await worker.get(NotificationWorker).check();
    await eventually(async () =>
      Boolean(
        (await db.client.backgroundTask.findUnique({ where: { id: verification.task.id } }))
          ?.completedAt,
      ),
    );
    expect(servers.messages).toHaveLength(1);
    const mail = servers.messages[0]!.replaceAll('=\r\n', '').replaceAll('=3D', '=');
    expect(mail).toContain(`${origin}/verify-email#token=`);
    expect(mail).toContain(verification.token);
    const jobs = await cache.client
      .scanIterator({ MATCH: `${config.REDIS_NAMESPACE}:queue:notifications:*`, COUNT: 100 })
      .next();
    expect(jobs.done).toBe(false);
    expect(
      (await db.client.backgroundTask.findUniqueOrThrow({ where: { id: verification.task.id } }))
        .payload,
    ).toEqual({});
    await post('/auth/verify-email', { token: verification.token }).expect(204);
    await post('/auth/verify-email', { token: verification.token }).expect(400);
    await worker.close();
    worker = undefined;
  }, 25_000);

  it('rotates SID/CSRF, rejects stale CSRF and explicit API keys, and logs out without resurrecting the old SID', async () => {
    const previousSid = sid;
    const previousCsrf = csrf;
    const response = await post('/auth/login', { email, password }).expect(200);
    sid = cookie(response);
    expect(sid).not.toBe(previousSid);
    await post('/auth/logout', {}, sid, previousCsrf).expect(403);
    const fresh = await api().get('/api/v1/auth/csrf').set('Cookie', sid).expect(200);
    csrf = tokenFrom(fresh);
    expect(csrf).not.toBe(previousCsrf);
    await api().get('/api/v1/users/me').set('Cookie', sid).expect(200);
    await api().get('/api/v1/users/me').set('Cookie', sid).set('X-API-Key', 'invalid').expect(401);
    await api()
      .get('/api/v1/auth/session')
      .set('Cookie', previousSid)
      .expect(200)
      .expect({ kind: 'anonymous' });
    const second = await bootstrap();
    const secondLogin = await post(
      '/auth/login',
      { email, password },
      second.sid,
      second.csrf,
    ).expect(200);
    otherSid = cookie(secondLogin);
    const otherCsrf = tokenFrom(
      await api().get('/api/v1/auth/csrf').set('Cookie', otherSid).expect(200),
    );
    await post('/auth/logout', {}, otherSid, otherCsrf).expect(204);
    await api().get('/api/v1/users/me').set('Cookie', otherSid).expect(401);
    // Directly simulate a late save by a request that had read the old session before logout.
    const store = new RevocableSessionStore(cache, () => 60);
    const syntheticSid = randomUUID();
    const saved: SessionData = { cookie: new Cookie(), csrfToken: 'controlled' };
    const put = () =>
      new Promise<void>((resolve, reject) => {
        void store.set(syntheticSid, saved, (error) =>
          error ? reject(new Error('Synthetic save rejected.')) : resolve(),
        );
      });
    await put();
    await new Promise<void>((resolve, reject) => {
      void store.destroy(syntheticSid, (error) =>
        error ? reject(new Error('Synthetic revocation failed.')) : resolve(),
      );
    });
    await expect(put()).rejects.toThrow();
    expect(await cache.client.get(cache.sessionPrefix + syntheticSid)).toBeNull();
  });

  it('confirms profile changes with the current password and only changes email on one-time confirmation', async () => {
    await api()
      .patch('/api/v1/users/me')
      .set('Origin', origin)
      .set('Cookie', sid)
      .set('X-CSRF-Token', csrf)
      .send({ email: nextEmail, displayName: ' Owned User ', currentPassword: 'wrong' })
      .expect(403);
    await api()
      .patch('/api/v1/users/me')
      .set('Origin', origin)
      .set('Cookie', sid)
      .set('X-CSRF-Token', csrf)
      .send({ email: nextEmail, displayName: ' Owned User ', currentPassword: password })
      .expect(200)
      .expect({
        profile: { id: userId, email, displayName: 'Owned User' },
        verificationRequired: true,
      });
    const pending = await link('email_change');
    expect((await db.client.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(email);
    await post('/auth/verify-email', { token: pending.token }).expect(204);
    await api().get('/api/v1/users/me').set('Cookie', sid).expect(401);
    ({ sid, csrf } = await bootstrap());
    const response = await post('/auth/login', { email: nextEmail, password }).expect(200);
    sid = cookie(response);
    csrf = tokenFrom(await api().get('/api/v1/auth/csrf').set('Cookie', sid).expect(200));
  });

  it('revokes all concurrent sessions on password change and reset, bounds token attempts and rejects token-purpose confusion', async () => {
    const second = await bootstrap();
    otherSid = cookie(
      await post('/auth/login', { email: nextEmail, password }, second.sid, second.csrf).expect(
        200,
      ),
    );
    await post('/users/me/password', { currentPassword: password, newPassword }).expect(204);
    await api().get('/api/v1/users/me').set('Cookie', otherSid).expect(401);
    ({ sid, csrf } = await bootstrap());
    await post('/auth/password-reset/request', { email: nextEmail }).expect(202);
    const recovery = await link('password_reset');
    await post('/auth/verify-email', { token: recovery.token }).expect(400);
    const wrongToken = recovery.token.slice(0, 37) + randomBytes(32).toString('base64url');
    for (let attempt = 0; attempt < 5; attempt++)
      await post('/auth/password-reset/confirm', {
        token: wrongToken,
        newPassword: password,
      })
        .set('X-Forwarded-For', '192.0.2.20')
        .expect(400);
    await post('/auth/password-reset/confirm', {
      token: recovery.token,
      newPassword: password,
    })
      .set('X-Forwarded-For', '192.0.2.20')
      .expect(400);
    expect(
      (
        await db.client.verificationToken.findUniqueOrThrow({
          where: { id: recovery.task.resourceId },
        })
      ).attempts,
    ).toBe(5);
    await post('/auth/password-reset/request', { email: nextEmail }).expect(202);
    const replacement = await link('password_reset');
    const response = await post('/auth/login', { email: nextEmail, password: newPassword }).expect(
      200,
    );
    otherSid = cookie(response);
    // Anonymous context remains separate from the authenticated cookie returned by login.
    ({ sid, csrf } = await bootstrap());
    await post('/auth/password-reset/confirm', {
      token: replacement.token,
      newPassword: password,
    }).expect(204);
    await api().get('/api/v1/users/me').set('Cookie', otherSid).expect(401);
    await post('/auth/password-reset/confirm', {
      token: replacement.token,
      newPassword: password,
    }).expect(400);
    expect((await db.client.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion).toBe(
      3,
    );
  });

  it('skips invalidated delivery intents, retries SMTP failure durably and atomically bounds concurrent rate attempts', async () => {
    const pending = await db.client.backgroundTask.findFirstOrThrow({
      where: {
        type: 'email_notification',
        resourceId: {
          in: (
            await db.client.verificationToken.findMany({
              where: { userId, consumedAt: { not: null } },
              select: { id: true },
            })
          ).map((token) => token.id),
        },
        completedAt: null,
      },
    });
    const delivery = new NotificationDeliveryService(
      db,
      app.get(EmailService),
      cipher,
      notification,
    );
    const sent = servers.messages.length;
    await delivery.deliver(pending.id);
    expect(servers.messages).toHaveLength(sent);
    expect(
      (await db.client.backgroundTask.findUniqueOrThrow({ where: { id: pending.id } })).completedAt,
    ).not.toBeNull();
    const accounts = app.get(AccountRepository);
    await accounts.transaction(async (tx) => {
      await accounts.lock(tx, userId);
      await app.get(NotificationsService).issue(tx, userId, 'password_reset', nextEmail);
    });
    const retry = await link('password_reset');
    const unavailableSmtp = jest
      .spyOn(app.get(EmailService), 'send')
      .mockRejectedValue(new Error('Synthetic SMTP outage.'));
    try {
      await expect(delivery.deliver(retry.task.id)).rejects.toThrow(
        'Notification delivery failed.',
      );
    } finally {
      unavailableSmtp.mockRestore();
    }
    const failed = await db.client.backgroundTask.findUniqueOrThrow({
      where: { id: retry.task.id },
    });
    expect(failed).toMatchObject({
      attempts: 1,
      completedAt: null,
      leaseToken: null,
      lastErrorCode: 'EMAIL_DELIVERY_FAILED',
    });
    expect(failed.availableAt.getTime()).toBeGreaterThan(Date.now());
    await db.client.backgroundTask.update({
      where: { id: retry.task.id },
      data: { availableAt: new Date() },
    });
    await delivery.deliver(retry.task.id);
    await delivery.deliver(retry.task.id);
    expect(servers.messages).toHaveLength(sent + 1);
    const rates = app.get(RateLimitService);
    const headers: Record<string, unknown> = {};
    const response = {
      setHeader: (name: string, value: unknown) => {
        headers[name] = value;
      },
    } as unknown as Response;
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => rates.check('owned-concurrent', runId, 3, 60_000, response)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(headers['Retry-After']).toBeGreaterThan(0);
  });

  it('rejects expired links and permits only one winner when a reset token is consumed concurrently', async () => {
    const accounts = app.get(AccountRepository);
    const issue = () =>
      accounts.transaction(async (tx) => {
        await accounts.lock(tx, userId);
        await app.get(NotificationsService).issue(tx, userId, 'password_reset', nextEmail);
      });
    await issue();
    const expired = await link('password_reset');
    const record = await db.client.verificationToken.findUniqueOrThrow({
      where: { id: expired.task.resourceId },
    });
    await db.client.verificationToken.update({
      where: { id: record.id },
      data: { expiresAt: new Date(record.createdAt.getTime() + 1) },
    });
    await post('/auth/password-reset/confirm', {
      token: expired.token,
      newPassword: password,
    }).expect(400);
    await issue();
    const current = await link('password_reset');
    const results = await Promise.all([
      post('/auth/password-reset/confirm', { token: current.token, newPassword: password }),
      post('/auth/password-reset/confirm', { token: current.token, newPassword: password }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([204, 400]);
  });

  it('expires idle and absolute sessions even if their Redis key still exists', async () => {
    for (const expiredField of ['idleExpiresAt', 'absoluteExpiresAt'] as const) {
      const anonymous = await bootstrap();
      const response = await post(
        '/auth/login',
        { email: nextEmail, password },
        anonymous.sid,
        anonymous.csrf,
      ).expect(200);
      const authenticated = cookie(response);
      const rawId = decodeURIComponent(authenticated.split('=')[1]!).slice(2).split('.')[0]!;
      const key = cache.sessionPrefix + rawId;
      const raw = await cache.client.get(key);
      if (!raw) throw new Error('Expected owned synthetic session.');
      const stored = JSON.parse(raw) as SessionData;
      stored.principal![expiredField] = Date.now() - 1;
      await cache.client.set(key, JSON.stringify(stored), { EX: 60 });
      await api().get('/api/v1/users/me').set('Cookie', authenticated).expect(401);
      expect(await cache.client.get(key)).toBeNull();
    }
  });

  it('uses a host-only Secure/HttpOnly/SameSite production cookie behind an explicitly trusted HTTPS proxy', async () => {
    const module = await Test.createTestingModule({ imports: [ApiModule.withAuthentication()] })
      .overrideProvider(INFRA_CONFIG)
      .useValue(config)
      .overrideProvider(AUTH_CONFIG)
      .useValue(auth)
      .overrideProvider(NOTIFICATION_CONFIG)
      .useValue({ ...notification, APP_ORIGIN: 'https://converter.example.test' })
      .compile();
    const secureApp = module.createNestApplication<NestExpressApplication<Server>>();
    secureApp.setGlobalPrefix('api/v1');
    configureAuthApi(secureApp);
    try {
      await secureApp.init();
      const result = await request(secureApp.getHttpServer())
        .get('/api/v1/auth/csrf')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);
      const header: unknown = result.headers['set-cookie'];
      if (!Array.isArray(header) || typeof header[0] !== 'string')
        throw new Error('Expected Secure session cookie.');
      expect(header[0]).toMatch(/^__Host-converter\.sid=/);
      expect(header[0]).toContain('; HttpOnly');
      expect(header[0]).toContain('; Secure');
      expect(header[0]).toContain('; SameSite=Lax');
      expect(header[0]).toContain('; Path=/');
      expect(header[0]).not.toContain('Domain=');
    } finally {
      await secureApp.close();
    }
  });

  it('fails closed if Redis is unavailable', async () => {
    await cache.stop();
    await api().get('/api/v1/auth/csrf').expect(503).expect('Cache-Control', 'no-store');
    await cache.start();
  });
});
