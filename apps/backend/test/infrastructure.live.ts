import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { ApiModule } from '../src/api.module.js';
import {
  INFRA_CONFIG,
  validateInfrastructureEnvironment,
} from '../src/infrastructure/config/infrastructure-config.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { RedisService } from '../src/infrastructure/redis/redis.service.js';
import { QueueService } from '../src/infrastructure/queue/queue.service.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';

it('connects real PostgreSQL, Redis and BullMQ with controlled local S3/SMTP and closes cleanly', async () => {
  const database = process.env.TEST_DATABASE_URL;
  const redis = process.env.TEST_REDIS_URL;
  if (!database || !redis)
    throw new Error('Explicit TEST_DATABASE_URL and TEST_REDIS_URL are required.');
  let valid = false;
  try {
    const pg = new URL(database);
    const cache = new URL(redis);
    valid =
      [pg, cache].every(
        (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.search,
      ) && /^\/converter_test(?:_[a-z0-9_]+)?$/.test(pg.pathname);
  } catch {
    /* Never include rejected connection strings in errors. */
  }
  if (!valid) throw new Error('Infrastructure tests require explicit loopback test services.');
  const servers = await infrastructureServers();
  const config = validateInfrastructureEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: database,
    REDIS_URL: redis,
    REDIS_NAMESPACE: `converter-test-${randomUUID()}`,
    S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
    SMTP_PORT: servers.smtpPort,
  });
  let app: INestApplication<Server> | undefined;
  try {
    const module = await Test.createTestingModule({ imports: [ApiModule.withInfrastructure()] })
      .overrideProvider(INFRA_CONFIG)
      .useValue(config)
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    await app.init();
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    await app.get(DatabaseService).check();
    const cache = app.get(RedisService);
    const key = `${config.REDIS_NAMESPACE}:probe`;
    await cache.client.set(key, 'probe', { EX: 30 });
    expect(await cache.client.get(key)).toBe('probe');
    await cache.client.del(key);
    const queue = app.get(QueueService).queue;
    const job = await queue.add('infrastructure-probe', { synthetic: true });
    expect(await job.getState()).toBe('waiting');
    await job.remove();
    // Scope is this run's random namespace; no product queue or global Redis flush.
    await queue.obliterate();
  } finally {
    await app?.close();
    await servers.close();
  }
}, 30_000);
