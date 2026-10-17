import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ApiModule } from '../src/api.module.js';
import { WorkerModule } from '../src/worker.module.js';
import request from 'supertest';

describe('backend application boundaries', () => {
  it('boots the HTTP shell without exposing product operations', async () => {
    const module = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    try {
      await request(app.getHttpServer()).post('/api/v1/conversions').expect(404);
    } finally {
      await app.close();
    }
  });
  it('boots and closes the independent worker context without infrastructure connections', async () => {
    const module = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await module.init();
    await module.close();
  });
});
