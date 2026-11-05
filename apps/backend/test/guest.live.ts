import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import request from 'supertest';
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
import { PasswordService } from '../src/modules/auth/password.service.js';
import { GuestCredentialsService } from '../src/modules/auth/guest/guest-credentials.service.js';
import { GuestTrialService } from '../src/modules/auth/guest/guest-trial.service.js';
import type { GuestPrincipal, GuestTransaction } from '../src/modules/auth/guest/guest.types.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';

const database = process.env.TEST_DATABASE_URL;
const redis = process.env.TEST_REDIS_URL;
if (!database || !redis)
  throw new Error('Explicit TEST_DATABASE_URL and TEST_REDIS_URL are required.');
for (const [value, isDatabase] of [
  [database, true],
  [redis, false],
] as const) {
  let valid = false;
  try {
    const url = new URL(value);
    valid =
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.search &&
      (isDatabase
        ? ['postgres:', 'postgresql:'].includes(url.protocol) &&
          /^\/converter_test(?:_[a-z0-9_]+)?$/.test(url.pathname)
        : url.protocol === 'redis:');
  } catch {
    /* No rejected connection values in diagnostics. */
  }
  if (!valid) throw new Error('Guest tests require dedicated loopback test services.');
}

describe('guest credentials and atomic trial accounting with real PostgreSQL/Redis', () => {
  let app: NestExpressApplication<Server>;
  let db: DatabaseService;
  let cache: RedisService;
  let credentials: GuestCredentialsService;
  let trials: GuestTrialService;
  let servers: Awaited<ReturnType<typeof infrastructureServers>>;
  const runId = randomUUID();
  const origin = 'http://127.0.0.1:5173';
  const guests = new Set<string>();
  const users = new Set<string>();
  let nextIp = 10;
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
  type Context = {
    sid: string;
    csrf: string;
    ip: string;
    guestCookie: string;
    principal: GuestPrincipal;
  };
  const api = () => request(app.getHttpServer());
  const cookieHeader = (response: request.Response, name: string) => {
    const cookies: unknown = response.headers['set-cookie'];
    if (!Array.isArray(cookies)) throw new Error('Expected owned synthetic cookie.');
    const found: unknown = cookies.find(
      (value: unknown) => typeof value === 'string' && value.startsWith(name + '='),
    );
    if (typeof found !== 'string') throw new Error('Expected owned synthetic cookie.');
    return found;
  };
  const csrfBody = (response: request.Response) => {
    const body: unknown = response.body;
    if (
      !body ||
      typeof body !== 'object' ||
      !('csrfToken' in body) ||
      typeof body.csrfToken !== 'string'
    )
      throw new Error('Expected CSRF bootstrap.');
    return body.csrfToken;
  };
  const post = (ctx: Pick<Context, 'sid' | 'csrf' | 'ip'>, guest = '') =>
    api()
      .post('/api/v1/guest-session')
      .set('Origin', origin)
      .set('X-CSRF-Token', ctx.csrf)
      .set('X-Forwarded-For', ctx.ip)
      .set('Cookie', ctx.sid + (guest ? '; ' + guest : ''))
      .send({});
  const anonymous = async () => {
    const ip = `198.51.100.${nextIp++}`;
    const response = await api().get('/api/v1/auth/csrf').set('X-Forwarded-For', ip).expect(200);
    return {
      ip,
      sid: cookieHeader(response, 'converter.dev.sid').split(';')[0]!,
      csrf: csrfBody(response),
    };
  };
  const context = async (): Promise<Context> => {
    const base = await anonymous();
    const response = await post(base).expect(200);
    const guestCookie = cookieHeader(response, 'converter.dev.guest').split(';')[0]!;
    const principal = await credentials.resolve(guestCookie.slice('converter.dev.guest='.length));
    guests.add(principal.guestSessionId);
    return { ...base, guestCookie, principal };
  };
  const transaction = <T>(work: (tx: GuestTransaction) => Promise<T>) =>
    db.client.$transaction(work, { timeout: 5_000, maxWait: 5_000 });
  const createJob = async (tx: GuestTransaction, principal: GuestPrincipal) => {
    const source = await tx.file.create({
      data: {
        guestSessionId: principal.guestSessionId,
        objectKey: `tests/${runId}/${randomUUID()}`,
        originalName: 'owned.jpg',
        format: 'jpg',
        detectedMime: 'image/jpeg',
        sizeBytes: 123n,
        purpose: 'input',
        retention: 'temporary',
      },
    });
    const job = await tx.conversion.create({
      data: {
        guestSessionId: principal.guestSessionId,
        sourceFileId: source.id,
        sourceFormat: 'jpg',
        targetFormat: 'png',
        saveResult: false,
      },
    });
    await tx.backgroundTask.create({
      data: {
        type: 'conversion_dispatch',
        resourceId: job.id,
        deduplicationKey: `test-dispatch:${job.id}`,
        payload: {},
      },
    });
    return job;
  };
  const accept = (ctx: Context) =>
    transaction((tx) => trials.reserve(tx, ctx.principal, (tx) => createJob(tx, ctx.principal)));
  const claim = (id: string) =>
    db.client.conversion.update({
      where: { id },
      data: {
        status: 'processing',
        processingVersion: { increment: 1 },
        attempts: { increment: 1 },
        startedAt: new Date(),
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
  const complete = async (
    tx: GuestTransaction,
    id: string,
    principal: GuestPrincipal,
    timestamp?: Date,
  ) => {
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const completedAt = timestamp ?? clock!.now;
    const result = await tx.file.create({
      data: {
        guestSessionId: principal.guestSessionId,
        objectKey: `tests/${runId}/${randomUUID()}`,
        originalName: 'owned.png',
        format: 'png',
        detectedMime: 'image/png',
        sizeBytes: 123n,
        purpose: 'output',
        retention: 'temporary',
        expiresAt: new Date(completedAt.getTime() + 3_600_000),
      },
    });
    return tx.conversion.update({
      where: { id },
      data: {
        status: 'completed',
        resultFileId: result.id,
        completedAt,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  };
  const fail = (tx: GuestTransaction, id: string) =>
    tx.conversion.update({
      where: { id },
      data: {
        status: 'failed',
        failedAt: new Date(),
        errorCode: 'INVALID_INPUT',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });

  beforeAll(async () => {
    servers = await infrastructureServers();
    config = validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: database,
      REDIS_URL: redis,
      REDIS_NAMESPACE: `guest-test-${runId}`,
      S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
      SMTP_PORT: servers.smtpPort,
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
    credentials = app.get(GuestCredentialsService);
    trials = app.get(GuestTrialService);
  });
  afterAll(async () => {
    if (db) {
      const ids = [...guests];
      const jobs = await db.client.conversion.findMany({
        where: { guestSessionId: { in: ids } },
        select: { id: true },
      });
      await transaction(async (tx) => {
        await tx.guestSession.updateMany({
          where: { id: { in: ids }, trialState: 'reserved' },
          data: { trialState: 'available', reservedConversionId: null },
        });
        await tx.backgroundTask.deleteMany({
          where: { type: 'conversion_dispatch', resourceId: { in: jobs.map((job) => job.id) } },
        });
        await tx.conversion.deleteMany({ where: { guestSessionId: { in: ids } } });
        await tx.file.deleteMany({ where: { guestSessionId: { in: ids } } });
        await tx.guestSession.deleteMany({ where: { id: { in: ids } } });
        await tx.user.deleteMany({ where: { id: { in: [...users] } } });
      });
    }
    if (cache)
      for await (const keys of cache.client.scanIterator({
        MATCH: `${config.REDIS_NAMESPACE}:*`,
        COUNT: 100,
      }))
        if (keys.length) await cache.client.del(keys);
    await app?.close();
    await servers?.close();
  });

  it('issues only a protected opaque cookie, preserves its absolute expiry and returns no credentials or internal ID', async () => {
    const ctx = await context();
    const response = await post(ctx, ctx.guestCookie)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body).toEqual({ trialState: 'available', activeConversionId: null });
    const stored = await db.client.guestSession.findUniqueOrThrow({
      where: { id: ctx.principal.guestSessionId },
    });
    expect(stored.tokenHash).not.toBe(ctx.guestCookie.slice('converter.dev.guest='.length));
    const cookie = cookieHeader(response, 'converter.dev.guest');
    expect(cookie).toContain('; HttpOnly');
    expect(cookie).toContain('; SameSite=Lax');
    expect(cookie).toContain('; Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(cookie).not.toContain('Max-Age=');
    expect(cookie).toContain('Expires=' + stored.credentialExpiresAt.toUTCString());
    await post(ctx, ctx.guestCookie).expect(200);
    expect(
      (await db.client.guestSession.findUniqueOrThrow({ where: { id: stored.id } }))
        .credentialExpiresAt,
    ).toEqual(stored.credentialExpiresAt);
  });
  it('requires exact Origin/CSRF, rejects unknown DTO fields, explicit API keys and invalid cookies without reminting quota', async () => {
    const ctx = await context();
    await api().post('/api/v1/guest-session').send({}).expect(403);
    await post({ ...ctx, csrf: 'incorrect' }, ctx.guestCookie).expect(403);
    await post(ctx, ctx.guestCookie).set('Origin', 'https://other.example.test').expect(403);
    await post(ctx, ctx.guestCookie).set('X-API-Key', 'invalid').expect(401);
    await post(ctx, ctx.guestCookie)
      .send({ unexpected: true })
      .expect(400)
      .expect({ error: { code: 'VALIDATION_FAILED', message: 'Invalid request fields.' } });
    const raw = () =>
      api()
        .post('/api/v1/guest-session')
        .set('Origin', origin)
        .set('X-CSRF-Token', ctx.csrf)
        .set('X-Forwarded-For', ctx.ip)
        .set('Cookie', ctx.sid + '; ' + ctx.guestCookie);
    await raw().send([]).expect(400);
    await raw().expect(400);
    for (const cookie of [
      'converter.dev.guest=bad',
      `converter.dev.guest=${randomBytes(32).toString('base64url')}`,
      ctx.guestCookie + '; ' + ctx.guestCookie,
    ])
      await post(ctx, cookie).expect(401);
    expect(
      await db.client.guestSession.count({ where: { id: ctx.principal.guestSessionId } }),
    ).toBe(1);
  });
  it('atomically admits just one concurrent job and rolls back input/job/outbox on acceptance failure', async () => {
    const ctx = await context();
    let rolledBackId = '';
    await expect(
      transaction((tx) =>
        trials.reserve(tx, ctx.principal, async (tx) => {
          rolledBackId = (await createJob(tx, ctx.principal)).id;
          throw new Error('Synthetic acceptance rollback.');
        }),
      ),
    ).rejects.toThrow('Synthetic acceptance rollback.');
    expect(
      await db.client.file.count({ where: { guestSessionId: ctx.principal.guestSessionId } }),
    ).toBe(0);
    expect(await db.client.conversion.count({ where: { id: rolledBackId } })).toBe(0);
    expect(
      await db.client.backgroundTask.count({
        where: { type: 'conversion_dispatch', resourceId: rolledBackId },
      }),
    ).toBe(0);
    await expect(
      transaction((tx) =>
        trials.reserve(tx, ctx.principal, async (tx) => {
          const job = await createJob(tx, ctx.principal);
          await tx.backgroundTask.deleteMany({
            where: { type: 'conversion_dispatch', resourceId: job.id },
          });
          return job;
        }),
      ),
    ).rejects.toThrow();
    expect(
      await db.client.conversion.count({ where: { guestSessionId: ctx.principal.guestSessionId } }),
    ).toBe(0);
    const results = await Promise.allSettled([accept(ctx), accept(ctx)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const job = await db.client.conversion.findFirstOrThrow({
      where: { guestSessionId: ctx.principal.guestSessionId },
    });
    await post(ctx, ctx.guestCookie)
      .expect(200)
      .expect({ trialState: 'reserved', activeConversionId: job.id });
    expect(
      await db.client.file.count({ where: { guestSessionId: ctx.principal.guestSessionId } }),
    ).toBe(1);
    expect(
      await db.client.backgroundTask.count({
        where: { type: 'conversion_dispatch', resourceId: job.id },
      }),
    ).toBe(1);
  });
  it('retains a reservation on retry, releases only terminal failure, and ignores delayed failure from an older job', async () => {
    const ctx = await context();
    const first = await accept(ctx);
    const attempt = await claim(first.id);
    await transaction((tx) =>
      trials.settle(tx, ctx.principal.guestSessionId, first.id, attempt, (tx) =>
        tx.conversion.update({
          where: { id: first.id },
          data: { status: 'queued', leaseToken: null, leaseExpiresAt: null },
        }),
      ),
    );
    expect(
      (
        await db.client.guestSession.findUniqueOrThrow({
          where: { id: ctx.principal.guestSessionId },
        })
      ).trialState,
    ).toBe('reserved');
    const queued = await db.client.conversion.findUniqueOrThrow({ where: { id: first.id } });
    await transaction((tx) =>
      trials.settle(tx, ctx.principal.guestSessionId, first.id, queued, (tx) => fail(tx, first.id)),
    );
    const second = await accept(ctx);
    await transaction((tx) =>
      trials.settle(tx, ctx.principal.guestSessionId, first.id, queued, () => {
        throw new Error('Terminal callbacks must not run.');
      }),
    );
    expect(
      (
        await db.client.guestSession.findUniqueOrThrow({
          where: { id: ctx.principal.guestSessionId },
        })
      ).reservedConversionId,
    ).toBe(second.id);
  });
  it('fences stale or expired processing attempts and consumes one successful result idempotently', async () => {
    const ctx = await context();
    const job = await accept(ctx);
    const attempt = await claim(job.id);
    await expect(
      transaction((tx) =>
        trials.settle(
          tx,
          ctx.principal.guestSessionId,
          job.id,
          { ...attempt, leaseToken: randomUUID() },
          (tx) => complete(tx, job.id, ctx.principal),
        ),
      ),
    ).rejects.toThrow();
    await db.client.conversion.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1) },
    });
    await expect(
      transaction((tx) =>
        trials.settle(tx, ctx.principal.guestSessionId, job.id, attempt, (tx) =>
          complete(tx, job.id, ctx.principal),
        ),
      ),
    ).rejects.toThrow();
    expect(
      await db.client.file.count({
        where: { guestSessionId: ctx.principal.guestSessionId, purpose: 'output' },
      }),
    ).toBe(0);
    await db.client.conversion.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() + 60_000) },
    });
    await transaction((tx) =>
      trials.settle(tx, ctx.principal.guestSessionId, job.id, attempt, (tx) =>
        complete(tx, job.id, ctx.principal),
      ),
    );
    const consumed = await db.client.guestSession.findUniqueOrThrow({
      where: { id: ctx.principal.guestSessionId },
    });
    await transaction((tx) =>
      trials.settle(tx, ctx.principal.guestSessionId, job.id, attempt, () => {
        throw new Error('Duplicate callback must not run.');
      }),
    );
    expect(
      (await db.client.guestSession.findUniqueOrThrow({ where: { id: consumed.id } })).consumedAt,
    ).toEqual(consumed.consumedAt);
    await expect(accept(ctx)).rejects.toMatchObject({
      response: { error: { code: 'GUEST_CONVERSION_LIMIT_REACHED' } },
    });
    await post(ctx, ctx.guestCookie)
      .expect(200)
      .expect({ trialState: 'consumed', activeConversionId: null });
    await db.client.file.updateMany({
      where: { guestSessionId: consumed.id, purpose: 'output' },
      data: { deletedAt: new Date(), storageDeletionState: 'pending' },
    });
    await post(ctx, ctx.guestCookie)
      .expect(200)
      .expect({ trialState: 'consumed', activeConversionId: null });
  });
  it('rejects near-expiry admission and completion without the full result-access window, without renewing expired credentials', async () => {
    const ctx = await context();
    await db.client.guestSession.update({
      where: { id: ctx.principal.guestSessionId },
      data: { credentialExpiresAt: new Date(Date.now() + 60_000) },
    });
    await expect(accept(ctx)).rejects.toThrow();
    await post(ctx, ctx.guestCookie).expect(200);
    const guest = await db.client.guestSession.findUniqueOrThrow({
      where: { id: ctx.principal.guestSessionId },
    });
    await db.client.guestSession.update({
      where: { id: guest.id },
      data: { credentialExpiresAt: new Date(guest.createdAt.getTime() + 1) },
    });
    await post(ctx, ctx.guestCookie).expect(401);
    const other = await context();
    const job = await accept(other);
    const attempt = await claim(job.id);
    await db.client.guestSession.update({
      where: { id: other.principal.guestSessionId },
      data: { credentialExpiresAt: new Date(Date.now() + 60_000) },
    });
    await expect(
      transaction((tx) =>
        trials.settle(tx, other.principal.guestSessionId, job.id, attempt, (tx) =>
          complete(tx, job.id, other.principal),
        ),
      ),
    ).rejects.toThrow();
    expect((await db.client.conversion.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'processing',
    );
  });
  it('rejects expired failure and stale versions while allowing explicit expired-lease reconciliation only without success', async () => {
    const ctx = await context();
    const job = await accept(ctx);
    const attempt = await claim(job.id);
    const callback = jest.fn((tx: GuestTransaction) => fail(tx, job.id));
    await expect(
      transaction((tx) =>
        trials.settle(
          tx,
          ctx.principal.guestSessionId,
          job.id,
          { ...attempt, processingVersion: attempt.processingVersion - 1 },
          callback,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      transaction((tx) =>
        trials.reconcileExpired(tx, ctx.principal.guestSessionId, job.id, attempt, callback),
      ),
    ).rejects.toThrow();
    await db.client.conversion.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1) },
    });
    await expect(
      transaction((tx) =>
        trials.settle(tx, ctx.principal.guestSessionId, job.id, attempt, callback),
      ),
    ).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled();
    await expect(
      transaction((tx) =>
        trials.reconcileExpired(tx, ctx.principal.guestSessionId, job.id, attempt, (tx) =>
          complete(tx, job.id, ctx.principal),
        ),
      ),
    ).rejects.toThrow();
    expect((await db.client.conversion.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'processing',
    );
    expect(
      (
        await db.client.guestSession.findUniqueOrThrow({
          where: { id: ctx.principal.guestSessionId },
        })
      ).trialState,
    ).toBe('reserved');
    await transaction((tx) =>
      trials.reconcileExpired(tx, ctx.principal.guestSessionId, job.id, attempt, callback),
    );
    expect(
      (
        await db.client.guestSession.findUniqueOrThrow({
          where: { id: ctx.principal.guestSessionId },
        })
      ).trialState,
    ).toBe('available');
  });
  it('rolls back backdated completion and keeps state-specific errors near credential expiry', async () => {
    const ctx = await context();
    const job = await accept(ctx);
    const attempt = await claim(job.id);
    await expect(
      transaction((tx) =>
        trials.settle(tx, ctx.principal.guestSessionId, job.id, attempt, (tx) =>
          complete(tx, job.id, ctx.principal, new Date(Date.now() - 7_200_000)),
        ),
      ),
    ).rejects.toThrow();
    expect(
      await db.client.file.count({
        where: { guestSessionId: ctx.principal.guestSessionId, purpose: 'output' },
      }),
    ).toBe(0);
    await db.client.guestSession.update({
      where: { id: ctx.principal.guestSessionId },
      data: { credentialExpiresAt: new Date(Date.now() + 5_400_000) },
    });
    await expect(accept(ctx)).rejects.toMatchObject({
      response: { error: { code: 'GUEST_CONVERSION_IN_PROGRESS' } },
    });
    await transaction((tx) =>
      trials.settle(tx, ctx.principal.guestSessionId, job.id, attempt, (tx) =>
        complete(tx, job.id, ctx.principal),
      ),
    );
    await expect(accept(ctx)).rejects.toMatchObject({
      response: { error: { code: 'GUEST_CONVERSION_LIMIT_REACHED' } },
    });
  });
  it('preserves guest capability and ownership across account login/logout, revocation and loss of the CSRF session', async () => {
    const ctx = await context();
    const stranger = await context();
    const job = await accept(ctx);
    const attempt = await claim(job.id);
    const completed = await transaction((tx) =>
      trials.settle(tx, ctx.principal.guestSessionId, job.id, attempt, (tx) =>
        complete(tx, job.id, ctx.principal),
      ),
    );
    const password = 'Owned test password 10';
    const user = await db.client.user.create({
      data: {
        email: `${runId}@example.test`,
        passwordHash: await app.get(PasswordService).hash(password),
        emailVerifiedAt: new Date(),
      },
    });
    users.add(user.id);
    const login = await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Cookie', ctx.sid + '; ' + ctx.guestCookie)
      .set('X-CSRF-Token', ctx.csrf)
      .send({ email: user.email, password })
      .expect(200);
    const sid = cookieHeader(login, 'converter.dev.sid').split(';')[0]!;
    const csrf = csrfBody(await api().get('/api/v1/auth/csrf').set('Cookie', sid).expect(200));
    await post({ ...ctx, sid, csrf }, ctx.guestCookie)
      .expect(200)
      .expect({ trialState: 'consumed', activeConversionId: null });
    await expect(
      transaction((tx) => trials.ownedConversion(tx, stranger.principal, job.id)),
    ).rejects.toMatchObject({ response: { error: { code: 'NOT_FOUND' } } });
    expect(
      (await transaction((tx) => trials.ownedConversion(tx, ctx.principal, job.id))).userId,
    ).toBeNull();
    expect(
      (await transaction((tx) => trials.ownedConversion(tx, ctx.principal, job.id))).resultFileId,
    ).toBe(completed!.resultFileId);
    await db.client.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    await post({ ...ctx, sid, csrf }, ctx.guestCookie).expect(200);
    await api().get('/api/v1/users/me').set('Cookie', ctx.guestCookie).expect(401);
    // A fresh CSRF context does not replace the durable guest identity or reset its trial.
    const fresh = await anonymous();
    await post(fresh, ctx.guestCookie)
      .expect(200)
      .expect({ trialState: 'consumed', activeConversionId: null });
    const again = await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Cookie', fresh.sid + '; ' + ctx.guestCookie)
      .set('X-CSRF-Token', fresh.csrf)
      .send({ email: user.email, password })
      .expect(200);
    const newSid = cookieHeader(again, 'converter.dev.sid').split(';')[0]!;
    const newCsrf = csrfBody(
      await api().get('/api/v1/auth/csrf').set('Cookie', newSid).expect(200),
    );
    await api()
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Cookie', newSid + '; ' + ctx.guestCookie)
      .set('X-CSRF-Token', newCsrf)
      .send({})
      .expect(204);
    const afterLogout = await anonymous();
    await post(afterLogout, ctx.guestCookie)
      .expect(200)
      .expect({ trialState: 'consumed', activeConversionId: null });
    expect(
      (await transaction((tx) => trials.ownedConversion(tx, ctx.principal, job.id))).resultFileId,
    ).toBe(completed!.resultFileId);
  });
  it('bounds issuance without replacing contexts and fails closed when Redis is unavailable', async () => {
    const existing = await context();
    for (let index = 0; index < 29; index++) await post(existing, existing.guestCookie).expect(200);
    await post(existing, existing.guestCookie).expect(429).expect('Retry-After', /\d+/);
    const base = await anonymous();
    for (let index = 0; index < 5; index++) {
      const response = await post(base).expect(200);
      const token = cookieHeader(response, 'converter.dev.guest')
        .split(';')[0]!
        .slice('converter.dev.guest='.length);
      guests.add((await credentials.resolve(token)).guestSessionId);
    }
    await post(base).expect(429).expect('Retry-After', /\d+/);
    await cache.stop();
    try {
      await post(base).expect(503).expect('Cache-Control', 'no-store');
    } finally {
      await cache.start();
    }
  });

  it('sets host-only Secure guest cookies through the trusted HTTPS proxy without returning the secret', async () => {
    const httpsOrigin = 'https://converter.example.test';
    const module = await Test.createTestingModule({ imports: [ApiModule.withAuthentication()] })
      .overrideProvider(INFRA_CONFIG)
      .useValue(config)
      .overrideProvider(AUTH_CONFIG)
      .useValue(auth)
      .overrideProvider(NOTIFICATION_CONFIG)
      .useValue({ ...notification, APP_ORIGIN: httpsOrigin })
      .compile();
    const secureApp = module.createNestApplication<NestExpressApplication<Server>>();
    secureApp.setGlobalPrefix('api/v1');
    configureAuthApi(secureApp);
    try {
      await secureApp.init();
      const csrfResponse = await request(secureApp.getHttpServer())
        .get('/api/v1/auth/csrf')
        .set('X-Forwarded-Proto', 'https')
        .expect(200);
      const sid = cookieHeader(csrfResponse, '__Host-converter.sid').split(';')[0]!;
      const response = await request(secureApp.getHttpServer())
        .post('/api/v1/guest-session')
        .set('X-Forwarded-Proto', 'https')
        .set('Origin', httpsOrigin)
        .set('Cookie', sid)
        .set('X-CSRF-Token', csrfBody(csrfResponse))
        .send({})
        .expect(200);
      const cookie = cookieHeader(response, '__Host-converter.guest');
      expect(cookie).toContain('; Secure');
      expect(cookie).toContain('; HttpOnly');
      expect(cookie).toContain('; SameSite=Lax');
      expect(cookie).toContain('; Path=/');
      expect(cookie).not.toContain('Domain=');
      expect(cookie).not.toContain('Max-Age=');
      expect(response.body).toEqual({ trialState: 'available', activeConversionId: null });
      const token = cookie.split(';')[0]!.slice('__Host-converter.guest='.length);
      guests.add((await secureApp.get(GuestCredentialsService).resolve(token)).guestSessionId);
    } finally {
      await secureApp.close();
    }
  });
});
