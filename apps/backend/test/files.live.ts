import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile, mkdir, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
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
import { StorageService } from '../src/infrastructure/storage/storage.service.js';
import { QueueService } from '../src/infrastructure/queue/queue.service.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { CleanupService } from '../src/modules/files/cleanup.service.js';
import { ConversionsService } from '../src/modules/conversions/conversions.service.js';
import { ConversionProcessingService } from '../src/modules/conversions/conversion-processing.service.js';
import { ConversionEngine } from '../src/modules/conversions/conversion-engine.js';
import { GuestTrialService } from '../src/modules/auth/guest/guest-trial.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';

jest.setTimeout(30_000);
const database = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
const redis = new URL(process.env.TEST_REDIS_URL ?? 'http://invalid');
if (
  database.hostname !== '127.0.0.1' ||
  database.protocol !== 'postgresql:' ||
  !/^\/converter_test(?:_[a-z0-9_]+)?$/.test(database.pathname) ||
  redis.hostname !== '127.0.0.1' ||
  redis.protocol !== 'redis:'
)
  throw new Error('Dedicated loopback converter_test database and Redis required.');

describe('saved files, retention and repeatable cleanup with real PostgreSQL and Redis', () => {
  let app: NestExpressApplication<Server>;
  let db: DatabaseService;
  let storage: StorageService;
  let queue: QueueService;
  let files: FilesService;
  let cleanup: CleanupService;
  let processing: ConversionProcessingService;
  let servers: Awaited<ReturnType<typeof infrastructureServers>>;
  let directory: string;
  let userId: string;
  let otherId: string;
  let key: string;
  let jpg: Buffer;
  const guests: string[] = [];
  const keys: string[] = [];
  const origin = 'http://127.0.0.1:5173';
  const api = () => request(app.getHttpServer());
  const page = (response: request.Response) =>
    response.body as components['schemas']['SavedFilesPage'];
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'files-test-'));
    servers = await infrastructureServers();
    const config = validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: database.href,
      REDIS_URL: redis.href,
      REDIS_NAMESPACE: `files-${randomUUID()}`,
      S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
      SMTP_PORT: servers.smtpPort,
      WORKER_TEMP_DIR: directory,
    });
    const module = await Test.createTestingModule({ imports: [ApiModule.withAuthentication()] })
      .overrideProvider(INFRA_CONFIG)
      .useValue(config)
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
    app = module.createNestApplication<NestExpressApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    configureAuthApi(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DatabaseService);
    storage = app.get(StorageService);
    queue = app.get(QueueService);
    files = app.get(FilesService);
    cleanup = new CleanupService(db, storage, config);
    // The controlled S3 fixture supports bytes; enumeration is supplied explicitly per test.
    jest.spyOn(storage, 'list').mockResolvedValue({ items: [], cursor: undefined });
    const engine = new ConversionEngine();
    jest.spyOn(engine, 'convert').mockImplementation(async (input) =>
      sharp(await readFile(input))
        .png()
        .toBuffer(),
    );
    processing = new ConversionProcessingService(
      db,
      storage,
      new GuestTrialService(),
      engine,
      config,
    );
    userId = (
      await db.client.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          passwordHash: await app.get(PasswordService).hash('Synthetic-test-password-16'),
          emailVerifiedAt: new Date(),
          settings: { create: { autoSave: true } },
        },
      })
    ).id;
    otherId = (
      await db.client.user.create({
        data: { email: `${randomUUID()}@example.test`, passwordHash: 'synthetic' },
      })
    ).id;
    const prefix = 'fc_' + randomBytes(12).toString('hex');
    key = prefix + '.' + randomBytes(32).toString('base64url');
    await db.client.apiKey.create({
      data: { userId, prefix, secretHash: createHash('sha256').update(key).digest('hex') },
    });
    jpg = await sharp({ create: { width: 3, height: 4, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
  });
  afterAll(async () => {
    if (db) {
      const owned = {
        OR: [{ userId: { in: [userId, otherId] } }, { guestSessionId: { in: guests } }],
      };
      const records = await db.client.file.findMany({ where: owned });
      const jobs = await db.client.conversion.findMany({ where: owned });
      await db.client.backgroundTask.deleteMany({
        where: {
          OR: [
            { resourceId: { in: [...records.map((f) => f.id), ...jobs.map((j) => j.id)] } },
            { deduplicationKey: { in: [...keys.map((k) => `unpublished:${k}`), 'cleanup:sweep'] } },
          ],
        },
      });
      await db.client.conversion.deleteMany({ where: owned });
      await db.client.file.deleteMany({ where: owned });
      await db.client.guestSession.deleteMany({ where: { id: { in: guests } } });
      await db.client.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
      await queue.queue.obliterate({ force: true });
    }
    await app?.close();
    await servers?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  async function saved(name: string, format: 'png' | 'pdf' = 'png', owner = userId) {
    const objectKey = storage.createKey('outputs');
    keys.push(objectKey);
    await storage.put(objectKey, jpg, 'image/png', jpg.length);
    return db.client.file.create({
      data: {
        userId: owner,
        objectKey,
        originalName: name,
        format,
        detectedMime: format === 'pdf' ? 'application/pdf' : 'image/png',
        sizeBytes: BigInt(jpg.length),
        purpose: 'output',
        retention: 'saved',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
  }
  async function run(save: boolean, guest = false) {
    await db.client.userSettings.update({ where: { userId }, data: { autoSave: save } });
    const principal = guest
      ? { kind: 'guest' as const, guestSessionId: randomUUID(), tokenHash: randomUUID() }
      : { kind: 'account' as const, userId };
    if (principal.kind === 'guest') {
      guests.push(principal.guestSessionId);
      await db.client.guestSession.create({
        data: {
          id: principal.guestSessionId,
          tokenHash: principal.tokenHash,
          credentialExpiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    }
    const path = join(directory, randomUUID());
    await writeFile(path, jpg);
    const job = await app
      .get(ConversionsService)
      .create(
        principal,
        { path, originalname: 'synthetic.jpg', size: jpg.length },
        { targetFormat: 'png' },
      );
    await db.client.userSettings.update({ where: { userId }, data: { autoSave: !save } });
    await processing.process(job.id);
    const row = await db.client.conversion.findUniqueOrThrow({
      where: { id: job.id },
      include: { result: true },
    });
    expect(row.status).toBe('completed');
    return { job: row, principal };
  }
  async function sweepNow() {
    await db.client.backgroundTask.updateMany({
      where: { deduplicationKey: 'cleanup:sweep' },
      data: { availableAt: new Date(0) },
    });
    await cleanup.sweep();
  }
  it('filters literal case-insensitive names, sorts tied dates, and resumes after cursor deletion', async () => {
    const a = await saved('Report_100%.png');
    const b = await saved('REPORT_100%.pdf', 'pdf');
    await saved('ReportX1000.png');
    await saved('Report_100%.png', 'png', otherId);
    const first = page(
      await api()
        .get('/api/v1/files')
        .set('X-API-Key', key)
        .query({ search: 'report_100%', limit: 1, sort: 'oldest' })
        .expect(200),
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    await files.delete(userId, first.items[0]!.id);
    const next = page(
      await api()
        .get('/api/v1/files')
        .set('X-API-Key', key)
        .query({ search: 'report_100%', limit: 1, sort: 'oldest', cursor: first.nextCursor })
        .expect(200),
    );
    expect(next.items).toHaveLength(1);
    expect(new Set([first.items[0]!.id, next.items[0]!.id])).toEqual(new Set([a.id, b.id]));
    expect(next.nextCursor).toBeNull();
    await api()
      .get('/api/v1/files')
      .set('X-API-Key', key)
      .query({ cursor: first.nextCursor })
      .expect(400);
    await api().get('/api/v1/files').set('X-API-Key', key).query({ limit: 101 }).expect(400);
    const filtered = page(
      await api().get('/api/v1/files').set('X-API-Key', key).query({ format: 'png' }).expect(200),
    );
    expect(filtered.items.every((file) => file.format === 'png')).toBe(true);
    await api()
      .get('/api/v1/files')
      .set('X-API-Key', key)
      .query({ format: ['png', 'pdf'] })
      .expect(400);
  });
  it('enforces account/key ownership, denies guests and invalid explicit keys', async () => {
    const other = await saved('private.png', 'png', otherId);
    for (const suffix of ['', '/download'])
      await api().get(`/api/v1/files/${other.id}${suffix}`).set('X-API-Key', key).expect(404);
    await api().delete(`/api/v1/files/${other.id}`).set('X-API-Key', key).expect(404);
    await api().get('/api/v1/files').expect(401);
    await api().get('/api/v1/files').set('X-API-Key', 'invalid').expect(401);
    await api().get('/api/v1/files/not-a-uuid').set('X-API-Key', key).expect(404);
  });
  it('snapshots auto-save at acceptance and blocks both download routes immediately after idempotent deletion', async () => {
    const { job } = await run(true);
    expect(job.result!.retention).toBe('saved');
    expect(job.result!.expiresAt).toBeNull();
    await api().get(`/api/v1/files/${job.resultFileId}`).set('X-API-Key', key).expect(200);
    await api().get(`/api/v1/files/${job.resultFileId}/download`).set('X-API-Key', key).expect(200);
    await api().get(`/api/v1/conversions/${job.id}/download`).set('X-API-Key', key).expect(200);
    for (let i = 0; i < 2; i++)
      await api().delete(`/api/v1/files/${job.resultFileId}`).set('X-API-Key', key).expect(204);
    expect(servers.objects.has(job.result!.objectKey)).toBe(true);
    await api().get(`/api/v1/files/${job.resultFileId}/download`).set('X-API-Key', key).expect(410);
    await api().get(`/api/v1/conversions/${job.id}/download`).set('X-API-Key', key).expect(410);
    await cleanup.deletions();
    expect(servers.objects.has(job.result!.objectKey)).toBe(false);
    await cleanup.deletions();
    expect(
      (await db.client.file.findUniqueOrThrow({ where: { id: job.resultFileId! } }))
        .storageDeletionState,
    ).toBe('deleted');
  });
  it('requires CSRF and exact Origin for cookie deletion and rejects guest file access', async () => {
    const cookie = (response: request.Response, name: string) => {
      const values: unknown = response.headers['set-cookie'];
      if (!Array.isArray(values)) throw new Error('Missing synthetic cookie.');
      const value: unknown = values.find(
        (entry: unknown) => typeof entry === 'string' && entry.startsWith(name + '='),
      );
      if (typeof value !== 'string') throw new Error('Missing synthetic cookie.');
      return value.split(';')[0]!;
    };
    const csrfResponse = await api().get('/api/v1/auth/csrf').expect(200);
    let sid = cookie(csrfResponse, 'converter.dev.sid');
    let csrf = (csrfResponse.body as { csrfToken: string }).csrfToken;
    const guestResponse = await api()
      .post('/api/v1/guest-session')
      .set('Cookie', sid)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect(200);
    const guestCookie = cookie(guestResponse, 'converter.dev.guest');
    await api()
      .get('/api/v1/files')
      .set('Cookie', sid + '; ' + guestCookie)
      .expect(401);
    const user = await db.client.user.findUniqueOrThrow({ where: { id: userId } });
    const login = await api()
      .post('/api/v1/auth/login')
      .set('Cookie', sid)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ email: user.email, password: 'Synthetic-test-password-16' })
      .expect(200);
    sid = cookie(login, 'converter.dev.sid');
    const session = await api().get('/api/v1/auth/csrf').set('Cookie', sid).expect(200);
    csrf = (session.body as { csrfToken: string }).csrfToken;
    const file = await saved('csrf.png');
    await api()
      .delete(`/api/v1/files/${file.id}`)
      .set('Cookie', sid)
      .set('Origin', origin)
      .expect(403);
    await api()
      .delete(`/api/v1/files/${file.id}`)
      .set('Cookie', sid)
      .set('Origin', 'https://other.example')
      .set('X-CSRF-Token', csrf)
      .expect(403);
    await api().get('/api/v1/files').set('Cookie', sid).set('X-API-Key', 'invalid').expect(401);
    await api()
      .delete(`/api/v1/files/${file.id}`)
      .set('Cookie', sid)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .expect(204);
    // Track the guest credential created through HTTP for fixture teardown.
    const { GuestCredentialsService } =
      await import('../src/modules/auth/guest/guest-credentials.service.js');
    guests.push(
      (await app.get(GuestCredentialsService).resolve(guestCookie.split('=')[1]!)).guestSessionId,
    );
  });
  it('fences acceptance when cleanup has already claimed an unpublished input', async () => {
    const put = storage.put.bind(storage);
    const spy = jest.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
      await put(...args);
      keys.push(args[0]);
      await db.client.backgroundTask.update({
        where: { deduplicationKey: `unpublished:${args[0]}` },
        data: { availableAt: new Date(0) },
      });
      await cleanup.deletions();
    });
    const path = join(directory, randomUUID());
    await writeFile(path, jpg);
    try {
      await expect(
        app
          .get(ConversionsService)
          .create(
            { kind: 'account', userId },
            { path, originalname: 'synthetic.jpg', size: jpg.length },
            { targetFormat: 'png' },
          ),
      ).rejects.toMatchObject({ response: { error: { code: 'CONVERSION_CAPACITY_REACHED' } } });
      expect(await db.client.file.findUnique({ where: { objectKey: keys.at(-1)! } })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
  it('expires temporary account/guest results at exactly one hour without saving or resetting quotas', async () => {
    for (const guest of [false, true]) {
      const { job, principal } = await run(false, guest);
      expect(job.result!.retention).toBe('temporary');
      expect(job.result!.expiresAt!.getTime() - job.completedAt!.getTime()).toBe(3_600_000);
      expect((await files.list(userId, {})).items.some((f) => f.id === job.resultFileId)).toBe(
        false,
      );
      // Persisted expiry is immutable; insert an already-expired synthetic result instead.
      const objectKey = storage.createKey('outputs');
      keys.push(objectKey);
      await storage.put(objectKey, jpg, 'image/png', jpg.length);
      const expired = await db.client.file.create({
        data: {
          userId: guest ? null : userId,
          guestSessionId: principal.kind === 'guest' ? principal.guestSessionId : null,
          objectKey,
          originalName: 'expired.png',
          format: 'png',
          detectedMime: 'image/png',
          sizeBytes: BigInt(jpg.length),
          purpose: 'output',
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await sweepNow();
      expect(
        (await db.client.file.findUniqueOrThrow({ where: { id: expired.id } }))
          .storageDeletionState,
      ).toBe('deleted');
      expect(servers.objects.has(job.result!.objectKey)).toBe(true);
      if (principal.kind === 'guest')
        expect(
          (
            await db.client.guestSession.findUniqueOrThrow({
              where: { id: principal.guestSessionId },
            })
          ).trialState,
        ).toBe('consumed');
    }
  });
  it('retries physical deletion failures and protects live saved outputs from malformed cleanup intents', async () => {
    const file = await saved('retry.png');
    await files.delete(userId, file.id);
    const remove = jest
      .spyOn(storage, 'remove')
      .mockRejectedValueOnce(new Error('synthetic outage'));
    await cleanup.deletions();
    const task = await db.client.backgroundTask.findUniqueOrThrow({
      where: { deduplicationKey: `delete:${file.id}` },
    });
    expect(task.completedAt).toBeNull();
    expect(task.lastErrorCode).toBe('STORAGE_DELETE_FAILED');
    await db.client.backgroundTask.update({
      where: { id: task.id },
      data: { availableAt: new Date(0) },
    });
    await cleanup.deletions();
    remove.mockRestore();
    expect(servers.objects.has(file.objectKey)).toBe(false);
    const live = await saved('live.png');
    await db.client.backgroundTask.create({
      data: {
        type: 'file_deletion',
        resourceId: live.id,
        deduplicationKey: `delete:${live.id}`,
        payload: { objectKey: live.objectKey },
      },
    });
    await cleanup.deletions();
    expect(servers.objects.has(live.objectKey)).toBe(true);
    await files.delete(userId, live.id);
    await cleanup.deletions();
    expect(servers.objects.has(live.objectKey)).toBe(false);
  });
  it('denies an expired conversion before cleanup and removes terminal-failure inputs', async () => {
    const sourceKey = storage.createKey('inputs');
    const resultKey = storage.createKey('outputs');
    keys.push(sourceKey, resultKey);
    for (const objectKey of [sourceKey, resultKey])
      await storage.put(objectKey, jpg, 'image/jpeg', jpg.length);
    const source = await db.client.file.create({
      data: {
        userId,
        objectKey: sourceKey,
        originalName: 'synthetic.jpg',
        format: 'jpg',
        detectedMime: 'image/jpeg',
        sizeBytes: BigInt(jpg.length),
        purpose: 'input',
      },
    });
    const output = await db.client.file.create({
      data: {
        userId,
        objectKey: resultKey,
        originalName: 'synthetic.png',
        format: 'png',
        detectedMime: 'image/png',
        sizeBytes: BigInt(jpg.length),
        purpose: 'output',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const job = await db.client.conversion.create({
      data: {
        userId,
        sourceFileId: source.id,
        sourceFormat: 'jpg',
        targetFormat: 'png',
        resultFileId: output.id,
        status: 'completed',
        completedAt: new Date(output.expiresAt!.getTime() - 3_600_000),
      },
    });
    await api().get(`/api/v1/conversions/${job.id}/download`).set('X-API-Key', key).expect(410);
    expect(servers.objects.has(resultKey)).toBe(true);
    const failureKey = storage.createKey('inputs');
    keys.push(failureKey);
    await storage.put(failureKey, jpg, 'image/jpeg', jpg.length);
    const failedInput = await db.client.file.create({
      data: {
        userId,
        objectKey: failureKey,
        originalName: 'synthetic.jpg',
        format: 'jpg',
        detectedMime: 'image/jpeg',
        sizeBytes: BigInt(jpg.length),
        purpose: 'input',
      },
    });
    await db.client.conversion.create({
      data: {
        userId,
        sourceFileId: failedInput.id,
        sourceFormat: 'jpg',
        targetFormat: 'png',
        status: 'failed',
        errorCode: 'ENGINE_FAILED',
        failedAt: new Date(),
      },
    });
    await sweepNow();
    expect(servers.objects.has(resultKey)).toBe(false);
    expect(servers.objects.has(sourceKey)).toBe(false);
    expect(servers.objects.has(failureKey)).toBe(false);
  });
  it('reconciles unknown orphan objects repeatedly and honors the sweep lease', async () => {
    const objectKey = storage.createKey('outputs');
    keys.push(objectKey);
    await storage.put(objectKey, jpg, 'image/png', jpg.length);
    const list = jest.spyOn(storage, 'list');
    list.mockResolvedValue({
      items: [{ key: objectKey, modifiedAt: new Date(Date.now() - 7_200_000) }],
      cursor: undefined,
    });
    await sweepNow();
    await cleanup.deletions();
    expect(servers.objects.has(objectKey)).toBe(false);
    await sweepNow();
    await cleanup.deletions();
    const calls = list.mock.calls.length;
    await db.client.backgroundTask.update({
      where: { deduplicationKey: 'cleanup:sweep' },
      data: {
        availableAt: new Date(0),
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const scratch = join(directory, 'attempt-abandoned');
    const active = join(directory, 'attempt-active');
    const unrelated = join(directory, 'unrelated');
    for (const path of [scratch, active, unrelated]) await mkdir(path);
    await utimes(scratch, new Date(0), new Date(0));
    await utimes(unrelated, new Date(0), new Date(0));
    await cleanup.sweep();
    expect(list.mock.calls).toHaveLength(calls);
    await expect(stat(scratch)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(active)).isDirectory()).toBe(true);
    expect((await stat(unrelated)).isDirectory()).toBe(true);
    await db.client.backgroundTask.update({
      where: { deduplicationKey: 'cleanup:sweep' },
      data: { leaseToken: null, leaseExpiresAt: null },
    });
    list.mockResolvedValue({ items: [], cursor: undefined });
  });
});
