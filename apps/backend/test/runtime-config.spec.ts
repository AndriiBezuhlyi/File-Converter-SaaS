import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ApiModule } from '../src/api.module.js';
import { WorkerModule } from '../src/worker.module.js';
import type { RuntimeEnvironment } from '../src/infrastructure/config/environment.js';

describe('validated runtime configuration integration', () => {
  it.each([
    ['API', ApiModule],
    ['worker', WorkerModule],
  ] as const)(
    'provides parsed startup configuration through the real %s module',
    async (_name, root) => {
      const module = await Test.createTestingModule({ imports: [root] }).compile();
      try {
        await module.init();
        const config = module.get<ConfigService<RuntimeEnvironment, true>>(ConfigService);
        const port = config.get('API_PORT', { infer: true });
        expect(typeof port).toBe('number');
        expect(Number.isInteger(port)).toBe(true);
        expect(port).toBeGreaterThanOrEqual(1);
        expect(port).toBeLessThanOrEqual(65535);
        expect(config.get('API_HOST', { infer: true })).toEqual(expect.any(String));
        expect(config.get('API_HOST', { infer: true }).length).toBeGreaterThan(0);
        expect(config.get('NODE_ENV', { infer: true })).toBe('test');
      } finally {
        await module.close();
      }
    },
  );
});
