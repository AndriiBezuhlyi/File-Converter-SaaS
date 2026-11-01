import 'reflect-metadata';
import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import { StorageService } from '../src/infrastructure/storage/storage.service.js';
import { EmailService } from '../src/infrastructure/email/email.service.js';
import { InfrastructureService } from '../src/infrastructure/infrastructure.service.js';

function dependencies() {
  return [DatabaseService, RedisService, QueueService, StorageService, EmailService].map(
    (token) => ({
      token,
      value: {
        start: jest.fn(async () => {}),
        check: jest.fn(async () => {}),
        stop: jest.fn(async () => {}),
      },
    }),
  );
}
async function fixture() {
  const fakes = dependencies();
  const builder = Test.createTestingModule({ imports: [ApiModule.withInfrastructure()] })
    .overrideProvider(INFRA_CONFIG)
    .useValue(
      validateInfrastructureEnvironment({ NODE_ENV: 'test', HEALTH_CHECK_INTERVAL_MS: 100 }),
    );
  for (const fake of fakes) builder.overrideProvider(fake.token).useValue(fake.value);
  const module = await builder.compile();
  const app = module.createNestApplication<INestApplication<Server>>();
  app.setGlobalPrefix('api/v1');
  return { app, fakes };
}

it('initializes the runtime, caches readiness, reports dependency failures safely and closes once', async () => {
  const { app, fakes } = await fixture();
  try {
    await app.init();
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect({ status: 'ok' });
    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ready.text).toContain('"database":"up"');
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(fakes[0]!.value.check).toHaveBeenCalledTimes(1);
    fakes[0]!.value.check.mockRejectedValue(new Error('private-connection-string'));
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 1_000);
    try {
      const unavailable = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);
      expect(unavailable.text).toContain('"database":"down"');
      expect(unavailable.text).not.toContain('private-connection-string');
    } finally {
      clock.mockRestore();
    }
    app.get(InfrastructureService).beforeApplicationShutdown();
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    await request(app.getHttpServer()).post('/api/v1/conversions').expect(404);
  } finally {
    await app.close();
  }
  for (const fake of fakes) {
    expect(fake.value.start).toHaveBeenCalledTimes(1);
    expect(fake.value.stop).toHaveBeenCalledTimes(1);
  }
});

it('rolls back every initialized dependency when runtime startup fails', async () => {
  const { app, fakes } = await fixture();
  fakes[2]!.value.start.mockRejectedValue(new Error('private-queue-credential'));
  try {
    await expect(app.init()).rejects.toThrow('Infrastructure startup failed.');
  } finally {
    await app.close();
  }
  for (const fake of fakes) expect(fake.value.stop).toHaveBeenCalledTimes(1);
});
