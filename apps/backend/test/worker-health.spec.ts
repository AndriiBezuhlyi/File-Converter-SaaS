import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { mkdir, mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { WorkerModule } from '../src/worker.module.js';
import {
  INFRA_CONFIG,
  validateInfrastructureEnvironment,
} from '../src/infrastructure/config/infrastructure-config.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { RedisService } from '../src/infrastructure/redis/redis.service.js';
import { QueueService } from '../src/infrastructure/queue/queue.service.js';
import { StorageService } from '../src/infrastructure/storage/storage.service.js';
import { EmailService } from '../src/infrastructure/email/email.service.js';

it('worker context emits an atomic readiness heartbeat and invalidates it on shutdown without HTTP', async () => {
  const cache = resolve(import.meta.dirname, '../../../.cache');
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(join(cache, 'worker-health-'));
  const builder = Test.createTestingModule({ imports: [WorkerModule.withInfrastructure()] })
    .overrideProvider(INFRA_CONFIG)
    .useValue(validateInfrastructureEnvironment({ NODE_ENV: 'test', WORKER_TEMP_DIR: temporary }));
  for (const dependency of [
    DatabaseService,
    RedisService,
    QueueService,
    StorageService,
    EmailService,
  ])
    builder.overrideProvider(dependency).useValue({
      start: jest.fn(async () => {}),
      check: jest.fn(async () => {}),
      stop: jest.fn(async () => {}),
    });
  const module = await builder.compile();
  try {
    await module.init();
    const heartbeat: unknown = JSON.parse(await readFile(join(temporary, 'health.json'), 'utf8'));
    expect(heartbeat).toEqual(expect.objectContaining({ pid: process.pid, ready: true }));
  } finally {
    await module.close();
  }
  const stopped: unknown = JSON.parse(await readFile(join(temporary, 'health.json'), 'utf8'));
  expect(stopped).toEqual(expect.objectContaining({ ready: false }));
  await unlink(join(temporary, 'health.json'));
  await rmdir(temporary);
});
