import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { RedisService } from '../src/infrastructure/redis/redis.service.js';
import { QueueService } from '../src/infrastructure/queue/queue.service.js';
import { validateInfrastructureEnvironment } from '../src/infrastructure/config/infrastructure-config.js';
import { faultProxy } from './fixtures/fault-proxy.js';

it('fails closed during real DB/Redis disconnection and recovers the existing queue job', async () => {
  const database = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
  const redis = new URL(process.env.TEST_REDIS_URL ?? 'http://invalid');
  if (
    [database, redis].some((url) => url.hostname !== '127.0.0.1' || url.search) ||
    database.protocol !== 'postgresql:' ||
    redis.protocol !== 'redis:' ||
    !/^\/converter_test_[a-z0-9_]+$/.test(database.pathname)
  )
    throw new Error('Explicit disposable loopback services required.');
  const pgProxy = await faultProxy(Number(database.port || 5432));
  const redisProxy = await faultProxy(Number(redis.port || 6379));
  database.port = String(pgProxy.port);
  redis.port = String(redisProxy.port);
  const config = validateInfrastructureEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: database.href,
    REDIS_URL: redis.href,
    REDIS_NAMESPACE: `fault-${randomUUID()}`,
    INFRA_TIMEOUT_MS: 2_000,
  });
  const db = new DatabaseService(config);
  const cache = new RedisService(config);
  const queue = new QueueService(config);
  try {
    await db.start();
    await cache.start();
    await queue.start();
    const job = await queue.queue.add('owned-probe', { synthetic: true });
    pgProxy.disconnect(true);
    redisProxy.disconnect(true);
    await expect(db.check()).rejects.toThrow();
    await expect(cache.check()).rejects.toThrow();
    await expect(queue.check()).rejects.toThrow();
    await expect(
      cache.client.set(`${config.REDIS_NAMESPACE}:denied`, 'synthetic'),
    ).rejects.toThrow();
    pgProxy.disconnect(false);
    redisProxy.disconnect(false);
    const deadline = Date.now() + 10_000;
    let recovered = false;
    while (Date.now() < deadline) {
      try {
        await Promise.all([db.check(), cache.check(), queue.check()]);
        recovered = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    expect(recovered).toBe(true);
    expect(await cache.client.get(`${config.REDIS_NAMESPACE}:denied`)).toBeNull();
    expect(await job.getState()).toBe('waiting');
    expect(await queue.queue.getWaitingCount()).toBe(1);
    await job.remove();
    await queue.queue.obliterate();
  } finally {
    pgProxy.disconnect(false);
    redisProxy.disconnect(false);
    await Promise.allSettled([queue.stop(), cache.stop(), db.stop()]);
    await Promise.all([pgProxy.close(), redisProxy.close()]);
  }
}, 30_000);
