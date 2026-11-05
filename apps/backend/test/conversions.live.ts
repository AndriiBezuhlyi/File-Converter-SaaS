import 'reflect-metadata';
import { jest } from '@jest/globals';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { readdir } from 'node:fs/promises';
import request from 'supertest';
import sharp from 'sharp';
import type { components } from '@converter/contracts';
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
import { QueueService } from '../src/infrastructure/queue/queue.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { GuestCredentialsService } from '../src/modules/auth/guest/guest-credentials.service.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';
import { documentArchive } from './fixtures/docx.js';
import { MAX_UPLOAD_BYTES } from '../src/modules/conversions/conversion-policy.js';
import { UPLOAD_STAGING_DIRECTORY } from '../src/modules/conversions/upload-staging.js';

jest.setTimeout(30_000);
const database = process.env.TEST_DATABASE_URL;
const redis = process.env.TEST_REDIS_URL;
for (const [value, isDatabase] of [
  [database, true],
  [redis, false],
] as const) {
  let valid = false;
  try {
    const url = new URL(value ?? '');
    valid =
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.search &&
      (isDatabase
        ? ['postgres:', 'postgresql:'].includes(url.protocol) &&
          /^\/converter_test(?:_[a-z0-9_]+)?$/.test(url.pathname)
        : url.protocol === 'redis:');
  } catch {
    /* Never expose rejected credential URLs. */
  }
  if (!valid)
    throw new Error(
      'Explicit loopback TEST_DATABASE_URL/converter_test and TEST_REDIS_URL are required.',
    );
}

describe('conversion REST lifecycle with real PostgreSQL, Redis and BullMQ', () => {
  let app: NestExpressApplication<Server>;
  let db: DatabaseService;
  let queue: QueueService;
  let servers: Awaited<ReturnType<typeof infrastructureServers>>;
  let config: ReturnType<typeof validateInfrastructureEnvironment>;
  let jpg: Buffer;
  let png: Buffer;
  const runId = randomUUID();
  const users: string[] = [];
  const guests: string[] = [];
  const origin = 'http://127.0.0.1:5173';
  const password = 'Owned-test-password-14';
  let ip = 10;
  const api = () => request(app.getHttpServer());
  const nextIp = () => `198.51.100.${ip++}`;
  const accepted = (response: request.Response) =>
    response.body as components['schemas']['ConversionAccepted'];
  const statusBody = (response: request.Response) =>
    response.body as components['schemas']['ConversionStatus'];
  const cookie = (response: request.Response, name: string) => {
    const headers: unknown = response.headers['set-cookie'];
    if (!Array.isArray(headers)) throw new Error('Missing synthetic cookie.');
    const value: unknown = headers.find(
      (entry: unknown) => typeof entry === 'string' && entry.startsWith(name + '='),
    );
    if (typeof value !== 'string') throw new Error('Missing synthetic cookie.');
    return value.split(';')[0]!;
  };
  const csrfContext = async () => {
    const response = await api()
      .get('/api/v1/auth/csrf')
      .set('X-Forwarded-For', nextIp())
      .expect(200);
    return {
      sid: cookie(response, 'converter.dev.sid'),
      csrf: (response.body as { csrfToken: string }).csrfToken,
    };
  };
  const guest = async () => {
    const ctx = await csrfContext();
    const response = await api()
      .post('/api/v1/guest-session')
      .set('X-Forwarded-For', nextIp())
      .set('Cookie', ctx.sid)
      .set('Origin', origin)
      .set('X-CSRF-Token', ctx.csrf)
      .send({})
      .expect(200);
    const credential = cookie(response, 'converter.dev.guest');
    const principal = await app.get(GuestCredentialsService).resolve(credential.split('=')[1]!);
    guests.push(principal.guestSessionId);
    return { ...ctx, credential, id: principal.guestSessionId };
  };
  const account = async (autoSave = false) => {
    const user = await db.client.user.create({
      data: {
        email: `conversion-${randomUUID()}@example.test`,
        passwordHash: await app.get(PasswordService).hash(password),
        emailVerifiedAt: new Date(),
        settings: { create: { autoSave } },
      },
    });
    users.push(user.id);
    const prefix = 'fc_' + randomBytes(12).toString('hex');
    const key = prefix + '.' + randomBytes(32).toString('base64url');
    await db.client.apiKey.create({
      data: { userId: user.id, prefix, secretHash: createHash('sha256').update(key).digest('hex') },
    });
    return { user, key };
  };
  const submitKey = (key: string, bytes = jpg, target = 'png') =>
    api()
      .post('/api/v1/conversions')
      .set('X-Forwarded-For', nextIp())
      .set('X-API-Key', key)
      .field('targetFormat', target)
      .attach('file', bytes, {
        filename: 'synthetic.exe',
        contentType: 'application/octet-stream',
      });
  const submitGuest = (ctx: Awaited<ReturnType<typeof guest>>, bytes = jpg) =>
    api()
      .post('/api/v1/conversions')
      .set('X-Forwarded-For', nextIp())
      .set('Cookie', ctx.sid + '; ' + ctx.credential)
      .set('Origin', origin)
      .set('X-CSRF-Token', ctx.csrf)
      .field('targetFormat', 'png')
      .attach('file', bytes, 'synthetic.jpg');
  const pollKey = (key: string, id: string) =>
    api()
      .get('/api/v1/conversions/' + id)
      .set('X-Forwarded-For', nextIp())
      .set('X-API-Key', key);

  beforeAll(async () => {
    servers = await infrastructureServers();
    config = validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: database,
      REDIS_URL: redis,
      REDIS_NAMESPACE: `conversion-test-${runId}`,
      S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
      SMTP_PORT: servers.smtpPort,
    });
    const module = await Test.createTestingModule({ imports: [ApiModule.withAuthentication()] })
      .overrideProvider(INFRA_CONFIG)
      .useValue(config)
      .overrideProvider(AUTH_CONFIG)
      .useValue(
        validateAuthConfig({
          SESSION_SECRET: randomBytes(32).toString('hex'),
          AUTH_TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
        }),
      )
      .overrideProvider(NOTIFICATION_CONFIG)
      .useValue(
        validateNotificationConfig({
          NODE_ENV: 'test',
          APP_ORIGIN: origin,
          NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        }),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    configureAuthApi(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    queue = app.get(QueueService);
    jpg = await sharp({ create: { width: 3, height: 4, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
    png = await sharp(jpg).png().toBuffer();
  });
  afterAll(async () => {
    if (db)
      await db.client.$transaction(async (tx) => {
        const where = { OR: [{ userId: { in: users } }, { guestSessionId: { in: guests } }] };
        const conversions = await tx.conversion.findMany({ where, select: { id: true } });
        await tx.guestSession.updateMany({
          where: { id: { in: guests }, trialState: 'reserved' },
          data: { trialState: 'available', reservedConversionId: null },
        });
        await tx.backgroundTask.deleteMany({
          where: {
            type: 'conversion_dispatch',
            resourceId: { in: conversions.map((job) => job.id) },
          },
        });
        await tx.conversion.deleteMany({ where });
        await tx.file.deleteMany({ where });
        await tx.guestSession.deleteMany({ where: { id: { in: guests } } });
        await tx.user.deleteMany({ where: { id: { in: users } } });
      });
    await app?.close();
    await servers?.close();
  });

  it('publishes exact limits and accepts every supported byte-detected direction with a durable intent and stable queue ID', async () => {
    await api()
      .get('/api/v1/capabilities')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({
          maxUploadBytes: MAX_UPLOAD_BYTES,
          pollIntervalMs: 1500,
          directions: { jpg: ['png'], png: ['jpg'], docx: ['pdf'] },
        });
      });
    const { key, user } = await account(true);
    for (const [bytes, source, target] of [
      [jpg, 'jpg', 'png'],
      [png, 'png', 'jpg'],
      [documentArchive(), 'docx', 'pdf'],
    ] as const) {
      const response = await submitKey(key, bytes, target)
        .expect(202)
        .expect('Cache-Control', 'no-store');
      const result = accepted(response);
      expect(result).toMatchObject({
        status: 'queued',
        sourceFormat: source,
        targetFormat: target,
        saveResult: true,
      });
      const row = await db.client.conversion.findUniqueOrThrow({
        where: { id: result.id },
        include: { source: true },
      });
      expect(row.userId).toBe(user.id);
      expect(row.source.detectedMime).not.toBe('application/octet-stream');
      expect(servers.objects.get(row.source.objectKey)?.bytes).toEqual(bytes);
      expect(
        await db.client.backgroundTask.count({
          where: { type: 'conversion_dispatch', resourceId: result.id, completedAt: null },
        }),
      ).toBe(1);
      expect((await queue.queue.getJob(result.id))?.data).toEqual({ conversionId: result.id });
    }
  });
  it('rejects missing authentication, Origin/CSRF and explicit invalid keys before accepting bytes', async () => {
    await api()
      .post('/api/v1/conversions')
      .set('X-API-Key', 'invalid')
      .send({})
      .expect(401)
      .expect({ error: { code: 'API_KEY_INVALID', message: 'A valid API key is required.' } });
    const ctx = await guest();
    await api()
      .post('/api/v1/conversions')
      .set('Cookie', ctx.sid + '; ' + ctx.credential)
      .send({})
      .expect(403);
    await api()
      .post('/api/v1/conversions')
      .set('Cookie', ctx.sid + '; ' + ctx.credential)
      .set('Origin', origin)
      .send({})
      .expect(403);
    await api()
      .get('/api/v1/conversions/' + randomUUID())
      .expect(401);
    await api()
      .get('/api/v1/conversions/' + randomUUID())
      .set('Cookie', ctx.sid + '; ' + ctx.credential)
      .set('X-API-Key', 'invalid')
      .expect(401);
  });
  it('rejects invalid/multiple/oversized uploads consistently without reserving a guest trial', async () => {
    const ctx = await guest();
    const objectsBefore = servers.objects.size;
    await submitGuest(ctx, Buffer.from('not a file')).expect(415);
    await submitGuest(ctx, Buffer.from([255, 216, 255, 0])).expect(422);
    await submitGuest(ctx, Buffer.alloc(MAX_UPLOAD_BYTES + 1))
      .expect(413)
      .expect({
        error: { code: 'FILE_TOO_LARGE', message: 'The uploaded file exceeds the allowed size.' },
      });
    await api()
      .post('/api/v1/conversions')
      .set('X-Forwarded-For', nextIp())
      .set('Cookie', ctx.sid + '; ' + ctx.credential)
      .set('Origin', origin)
      .set('X-CSRF-Token', ctx.csrf)
      .field('targetFormat', 'png')
      .attach('file', jpg, 'one.jpg')
      .attach('file', jpg, 'two.jpg')
      .expect(400);
    await api()
      .post('/api/v1/conversions')
      .set('X-Forwarded-For', nextIp())
      .set('Cookie', ctx.sid + '; ' + ctx.credential)
      .set('Origin', origin)
      .set('X-CSRF-Token', ctx.csrf)
      .field('targetFormat', 'png')
      .field('extra', 'invalid')
      .attach('file', jpg, 'one.jpg')
      .expect(400);
    expect(
      (await db.client.guestSession.findUniqueOrThrow({ where: { id: ctx.id } })).trialState,
    ).toBe('available');
    expect(servers.objects.size).toBe(objectsBefore);
  });
  it('atomically accepts only one concurrent guest request and hides it from other principals', async () => {
    const ctx = await guest();
    const other = await guest();
    const results = await Promise.all([submitGuest(ctx), submitGuest(ctx)]);
    expect(results.map((response) => response.status).sort()).toEqual([202, 409]);
    const id = accepted(results.find((response) => response.status === 202)!).id;
    expect(await db.client.conversion.count({ where: { guestSessionId: ctx.id } })).toBe(1);
    const ownerPoll = await api()
      .get('/api/v1/conversions/' + id)
      .set('Cookie', ctx.credential)
      .expect(200);
    expect(statusBody(ownerPoll)).toMatchObject({
      status: 'queued',
      saveResult: false,
      resultAvailability: 'pending',
    });
    await api()
      .get('/api/v1/conversions/' + id)
      .set('Cookie', other.credential)
      .expect(404);
    const { key } = await account();
    await pollKey(key, id).set('Cookie', ctx.credential).expect(404);
  });
  it('retains guest ownership after login and creates new conversions under the account snapshot', async () => {
    const ctx = await guest();
    const id = accepted(await submitGuest(ctx).expect(202)).id;
    const { user } = await account(true);
    const login = await api()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextIp())
      .set('Cookie', ctx.sid + '; ' + ctx.credential)
      .set('Origin', origin)
      .set('X-CSRF-Token', ctx.csrf)
      .send({ email: user.email, password })
      .expect(200);
    const sid = cookie(login, 'converter.dev.sid');
    await api()
      .get('/api/v1/conversions/' + id)
      .set('Cookie', sid + '; ' + ctx.credential)
      .expect(200);
    await api()
      .get('/api/v1/conversions/' + id)
      .set('Cookie', sid)
      .expect(404);
    const csrfResponse = await api().get('/api/v1/auth/csrf').set('Cookie', sid).expect(200);
    const csrf = (csrfResponse.body as { csrfToken: string }).csrfToken;
    const created = accepted(
      await api()
        .post('/api/v1/conversions')
        .set('X-Forwarded-For', nextIp())
        .set('Cookie', sid + '; ' + ctx.credential)
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf)
        .field('targetFormat', 'png')
        .attach('file', jpg, 'owned.jpg')
        .expect(202),
    );
    expect(created.saveResult).toBe(true);
    await db.client.userSettings.update({ where: { userId: user.id }, data: { autoSave: false } });
    expect(
      (await db.client.conversion.findUniqueOrThrow({ where: { id: created.id } })).saveResult,
    ).toBe(true);
    await db.client.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    await api()
      .get('/api/v1/conversions/' + id)
      .set('Cookie', sid + '; ' + ctx.credential)
      .expect(200);
  });
  it('preserves accepted input and intent if dispatch fails, and rejects unavailable queue before acceptance', async () => {
    const { key } = await account();
    const add = jest
      .spyOn(queue.queue, 'add')
      .mockRejectedValueOnce(new Error('Synthetic queue outage.'));
    try {
      const id = accepted(await submitKey(key).expect(202)).id;
      expect(statusBody(await pollKey(key, id).expect(200)).status).toBe('queued');
      expect(
        await db.client.backgroundTask.count({ where: { resourceId: id, completedAt: null } }),
      ).toBe(1);
    } finally {
      add.mockRestore();
    }
    const check = jest
      .spyOn(queue, 'check')
      .mockRejectedValueOnce(new Error('Synthetic queue outage.'));
    const before = servers.objects.size;
    try {
      await submitKey(key)
        .expect(503)
        .expect({
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.' },
        });
    } finally {
      check.mockRestore();
    }
    expect(servers.objects.size).toBe(before);
  });
  it('polls processing, failure, completion and result expiry/deletion without leaking internal fields', async () => {
    const { key, user } = await account();
    const { key: other } = await account();
    const id = accepted(await submitKey(key).expect(202)).id;
    await pollKey(other, id).expect(404);
    await pollKey(key, 'malformed-id').expect(404);
    await db.client.conversion.update({
      where: { id },
      data: {
        status: 'processing',
        startedAt: new Date(),
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(statusBody(await pollKey(key, id).expect(200)).status).toBe('processing');
    await db.client.conversion.update({
      where: { id },
      data: {
        status: 'failed',
        failedAt: new Date(),
        errorCode: 'INTERNAL_SECRET_DETAILS',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    const failed = statusBody(await pollKey(key, id).expect(200));
    expect(failed).toMatchObject({
      status: 'failed',
      resultAvailability: 'unavailable',
      error: { code: 'CONVERSION_FAILED' },
    });
    expect(JSON.stringify(failed)).not.toContain('INTERNAL_SECRET_DETAILS');
    const completedId = accepted(await submitKey(key).expect(202)).id;
    const result = await db.client.file.create({
      data: {
        userId: user.id,
        objectKey: 'outputs/' + randomUUID(),
        originalName: 'owned.png',
        format: 'png',
        detectedMime: 'image/png',
        sizeBytes: 123n,
        purpose: 'output',
        retention: 'temporary',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await db.client.conversion.update({
      where: { id: completedId },
      data: { status: 'completed', completedAt: new Date(), resultFileId: result.id },
    });
    const completed = statusBody(await pollKey(key, completedId).expect(200));
    expect(completed).toMatchObject({
      status: 'completed',
      resultAvailability: 'available',
      result: { id: result.id, sizeBytes: 123, retention: 'temporary' },
    });
    expect(JSON.stringify(completed)).not.toContain(result.objectKey);
    const expiredId = accepted(await submitKey(key).expect(202)).id;
    const expiredResult = await db.client.file.create({
      data: {
        userId: user.id,
        objectKey: 'outputs/' + randomUUID(),
        originalName: 'expired.png',
        format: 'png',
        detectedMime: 'image/png',
        sizeBytes: 123n,
        purpose: 'output',
        retention: 'temporary',
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    await db.client.conversion.update({
      where: { id: expiredId },
      data: {
        status: 'completed',
        completedAt: new Date(Date.now() - 3_601_000),
        resultFileId: expiredResult.id,
      },
    });
    expect(statusBody(await pollKey(key, expiredId).expect(200)).resultAvailability).toBe(
      'expired',
    );
    await db.client.file.update({
      where: { id: result.id },
      data: { deletedAt: new Date(), storageDeletionState: 'pending' },
    });
    expect(statusBody(await pollKey(key, completedId).expect(200)).resultAvailability).toBe(
      'deleted',
    );
  });
  it('bounds active jobs per account and removes the rejected private input', async () => {
    const { key } = await account();
    for (let index = 0; index < 5; index++) await submitKey(key).expect(202);
    const before = servers.objects.size;
    await submitKey(key).expect(429);
    expect(servers.objects.size).toBe(before);
  });
  it('bounds concurrent staging and removes aborted uploads before releasing capacity', async () => {
    const { key, user } = await account();
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('Missing local test listener.');
    const partial = Array.from({ length: 4 }, () => {
      const upload = httpRequest({
        host: '127.0.0.1',
        port: address.port,
        path: '/api/v1/conversions',
        method: 'POST',
        headers: {
          'X-API-Key': key,
          'X-Forwarded-For': nextIp(),
          'Content-Type': 'multipart/form-data; boundary=owned-boundary',
        },
      });
      upload.on('error', () => undefined);
      upload.write(
        '--owned-boundary\r\nContent-Disposition: form-data; name="file"; filename="owned.jpg"\r\nContent-Type: image/jpeg\r\n\r\n',
      );
      upload.write(Buffer.alloc(4096));
      return upload;
    });
    const waitForFiles = async (count: number) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await readdir(UPLOAD_STAGING_DIRECTORY)).length === count) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Staging file count did not converge.');
    };
    try {
      await waitForFiles(4);
      await submitKey(key)
        .expect(429)
        .expect({
          error: {
            code: 'UPLOAD_CAPACITY_REACHED',
            message: 'Upload capacity is temporarily full.',
          },
        });
    } finally {
      for (const upload of partial) upload.destroy();
    }
    await waitForFiles(0);
    expect(await db.client.conversion.count({ where: { userId: user.id } })).toBe(0);
    await submitKey(key).expect(202);
    await waitForFiles(0);
  });
});
