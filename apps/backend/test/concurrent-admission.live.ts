import 'reflect-metadata';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import sharp from 'sharp';
import { ApiModule } from '../src/api.module.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { StorageService } from '../src/infrastructure/storage/storage.service.js';
import { QueueService } from '../src/infrastructure/queue/queue.service.js';
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
import { infrastructureServers } from './fixtures/infrastructure-servers.js';

for (const [name, protocol] of [
  ['TEST_DATABASE_URL', 'postgresql:'],
  ['TEST_REDIS_URL', 'redis:'],
] as const) {
  const url = new URL(process.env[name] ?? 'http://invalid');
  if (
    url.hostname !== '127.0.0.1' ||
    url.protocol !== protocol ||
    url.search ||
    (name === 'TEST_DATABASE_URL' && !/^\/converter_test_[a-z0-9_]+$/.test(url.pathname))
  )
    throw new Error('Explicit isolated loopback test services required.');
}

describe('parallel API callers at the account admission boundary', () => {
  let app: NestExpressApplication<Server>;
  let db: DatabaseService;
  let servers: Awaited<ReturnType<typeof infrastructureServers>>;
  const userId = randomUUID();
  const prefix = 'fc_' + randomBytes(12).toString('hex');
  const key = prefix + '.' + randomBytes(32).toString('base64url');
  beforeAll(async () => {
    servers = await infrastructureServers();
    const config = validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      REDIS_URL: process.env.TEST_REDIS_URL,
      REDIS_NAMESPACE: `concurrency-${randomUUID()}`,
      S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
      SMTP_PORT: servers.smtpPort,
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
          APP_ORIGIN: 'http://127.0.0.1:5173',
          NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        }),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    configureAuthApi(app);
    await app.init();
    db = app.get(DatabaseService);
    await db.client.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'synthetic',
        emailVerifiedAt: new Date(),
        apiKeys: { create: { prefix, secretHash: createHash('sha256').update(key).digest('hex') } },
      },
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (db) {
      const jobs = await db.client.conversion.findMany({ where: { userId }, select: { id: true } });
      await db.client.backgroundTask.deleteMany({
        where: { resourceId: { in: jobs.map((job) => job.id) } },
      });
      await db.client.conversion.deleteMany({ where: { userId } });
      await db.client.file.deleteMany({ where: { userId } });
      await db.client.user.deleteMany({ where: { id: userId } });
    }
    if (app) {
      await app.get(QueueService).queue.obliterate({ force: true });
      await app.close();
    }
    await servers?.close();
  });

  it('serializes two independently uploaded requests for the fifth slot and cleans the rejected object', async () => {
    const bytes = await sharp({ create: { width: 3, height: 4, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
    const submit = () =>
      request(app.getHttpServer())
        .post('/api/v1/conversions')
        .set('X-API-Key', key)
        .field('targetFormat', 'png')
        .attach('file', bytes, 'owned.jpg');
    for (let index = 0; index < 4; index++) await submit().expect(202);
    const storage = app.get(StorageService);
    const put = storage.put.bind(storage);
    let arrivals = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    const barrier = jest.spyOn(storage, 'put').mockImplementation(async (...args) => {
      if (++arrivals === 2) release();
      await both;
      await put(...args);
    });
    try {
      const responses = await Promise.all([submit(), submit()]);
      expect(responses.map((response) => response.status).sort()).toEqual([202, 429]);
      expect(responses.find((response) => response.status === 429)?.body).toMatchObject({
        error: { code: 'CONVERSION_CAPACITY_REACHED' },
      });
      const jobs = await db.client.conversion.findMany({ where: { userId } });
      expect(jobs).toHaveLength(5);
      expect(new Set(jobs.map((job) => job.id)).size).toBe(5);
      expect(await db.client.file.count({ where: { userId, purpose: 'input' } })).toBe(5);
      expect(
        await db.client.backgroundTask.count({
          where: {
            type: 'conversion_dispatch',
            resourceId: { in: jobs.map((job) => job.id) },
          },
        }),
      ).toBe(5);
      expect(servers.objects.size).toBe(5);
    } finally {
      release();
      barrier.mockRestore();
    }
  }, 30_000);
});
