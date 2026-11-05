import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { StorageService } from '../src/infrastructure/storage/storage.service.js';
import { QueueService } from '../src/infrastructure/queue/queue.service.js';
import { validateInfrastructureEnvironment } from '../src/infrastructure/config/infrastructure-config.js';
import { GuestTrialService } from '../src/modules/auth/guest/guest-trial.service.js';
import { ConversionProcessingService } from '../src/modules/conversions/conversion-processing.service.js';
import { ConversionEngine, EngineFailure } from '../src/modules/conversions/conversion-engine.js';
import { ConversionWorker } from '../src/modules/conversions/conversion-worker.js';
import { ConversionsService } from '../src/modules/conversions/conversions.service.js';
import type { InfrastructureService } from '../src/infrastructure/infrastructure.service.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';

jest.setTimeout(25_000);
for (const [key, protocol] of [
  ['TEST_DATABASE_URL', 'postgresql:'],
  ['TEST_REDIS_URL', 'redis:'],
] as const) {
  const url = new URL(process.env[key] ?? 'http://invalid');
  if (
    url.hostname !== '127.0.0.1' ||
    url.protocol !== protocol ||
    (key === 'TEST_DATABASE_URL' && !/^\/converter_test_[a-z0-9_]+$/.test(url.pathname))
  )
    throw new Error('Explicit isolated loopback test services required.');
}

describe('durable conversion processing with PostgreSQL, Redis, BullMQ and private-storage fixture', () => {
  let db: DatabaseService;
  let storage: StorageService;
  let queue: QueueService;
  let servers: Awaited<ReturnType<typeof infrastructureServers>>;
  let processing: ConversionProcessingService;
  let conversions: ConversionsService;
  let config: ReturnType<typeof validateInfrastructureEnvironment>;
  let directory: string;
  let userId: string;
  const engine = new ConversionEngine();
  jest.spyOn(engine, 'check').mockResolvedValue(undefined);
  const calls = jest.spyOn(engine, 'convert');
  const trials = new GuestTrialService();
  const ids: string[] = [];
  const guests: string[] = [];
  let jpg: Buffer;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'processing-test-'));
    servers = await infrastructureServers();
    config = validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      REDIS_URL: process.env.TEST_REDIS_URL,
      REDIS_NAMESPACE: `processing-${randomUUID()}`,
      S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
      SMTP_PORT: servers.smtpPort,
      WORKER_TEMP_DIR: directory,
    });
    db = new DatabaseService(config);
    storage = new StorageService(config);
    queue = new QueueService(config);
    await db.start();
    await storage.start();
    await queue.start();
    processing = new ConversionProcessingService(db, storage, trials, engine, config);
    conversions = new ConversionsService(db, storage, queue, trials);
    const user = await db.client.user.create({
      data: { email: `${randomUUID()}@example.test`, passwordHash: 'synthetic' },
    });
    userId = user.id;
    jpg = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#f00' } })
      .jpeg()
      .toBuffer();
  });
  beforeEach(() =>
    calls.mockImplementation(async (input, _source, target) => {
      const bytes = await readFile(input);
      return target === 'png' ? sharp(bytes).png().toBuffer() : sharp(bytes).jpeg().toBuffer();
    }),
  );
  afterAll(async () => {
    if (queue) {
      await queue.queue.obliterate({ force: true });
      await queue.stop();
    }
    if (db) {
      await db.client.guestSession.updateMany({
        where: { id: { in: guests }, trialState: 'reserved' },
        data: { trialState: 'available', reservedConversionId: null },
      });
      await db.client.backgroundTask.deleteMany({ where: { resourceId: { in: ids } } });
      const files = await db.client.file.findMany({
        where: { OR: [{ userId }, { guestSessionId: { in: guests } }] },
        select: { id: true },
      });
      await db.client.backgroundTask.deleteMany({
        where: { resourceId: { in: files.map((file) => file.id) } },
      });
      await db.client.conversion.deleteMany({ where: { id: { in: ids } } });
      await db.client.file.deleteMany({ where: { id: { in: files.map((file) => file.id) } } });
      await db.client.guestSession.deleteMany({ where: { id: { in: guests } } });
      await db.client.user.delete({ where: { id: userId } });
      await db.stop();
    }
    storage?.stop();
    await servers?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  async function accepted(guest = false, saveResult = false) {
    const id = randomUUID();
    ids.push(id);
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
    const objectKey = storage.createKey('inputs');
    await storage.put(objectKey, jpg, 'image/jpeg', jpg.length);
    await db.client.$transaction(async (tx) => {
      const create = async () => {
        const source = await tx.file.create({
          data: {
            userId: guest ? null : userId,
            guestSessionId: principal.kind === 'guest' ? principal.guestSessionId : null,
            objectKey,
            originalName: 'synthetic.jpg',
            format: 'jpg',
            detectedMime: 'image/jpeg',
            sizeBytes: BigInt(jpg.length),
            purpose: 'input',
          },
        });
        const conversion = await tx.conversion.create({
          data: {
            id,
            userId: source.userId,
            guestSessionId: source.guestSessionId,
            sourceFileId: source.id,
            sourceFormat: 'jpg',
            targetFormat: 'png',
            saveResult,
          },
        });
        await tx.backgroundTask.create({
          data: {
            type: 'conversion_dispatch',
            resourceId: id,
            deduplicationKey: `conversion:${id}`,
          },
        });
        return conversion;
      };
      if (principal.kind === 'guest') await trials.reserve(tx, principal, create);
      else await create();
    });
    return { id, principal };
  }
  const row = (id: string) =>
    db.client.conversion.findUniqueOrThrow({ where: { id }, include: { result: true } });
  async function retryNow(id: string) {
    await db.client.backgroundTask.update({
      where: { deduplicationKey: `conversion:${id}` },
      data: { availableAt: new Date(0) },
    });
  }

  it('publishes once under concurrent delivery, preserves acceptance-time retention and real downloadable bytes', async () => {
    const job = await accepted(false, true);
    await Promise.all([processing.process(job.id), processing.process(job.id)]);
    const result = await row(job.id);
    expect(result.status).toBe('completed');
    expect(result.attempts).toBe(1);
    expect(result.result?.retention).toBe('saved');
    expect(result.result?.expiresAt).toBeNull();
    const downloaded = await conversions.download(job.principal, job.id);
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded.body) chunks.push(Buffer.from(chunk as Uint8Array));
    expect((await sharp(Buffer.concat(chunks)).metadata()).format).toBe('png');
    await processing.process(job.id);
    expect((await row(job.id)).resultFileId).toBe(result.resultFileId);
    await expect(
      conversions.download({ kind: 'account', userId: randomUUID() }, job.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('consumes a guest trial only on publication with exactly one-hour expiry; login retains capability access', async () => {
    const job = await accepted(true);
    await processing.process(job.id);
    const result = await row(job.id);
    expect(result.status).toBe('completed');
    expect(result.result!.expiresAt!.getTime() - result.completedAt!.getTime()).toBe(3_600_000);
    const principal = job.principal;
    if (principal.kind !== 'guest') throw new Error('Expected guest.');
    expect(
      (await db.client.guestSession.findUniqueOrThrow({ where: { id: principal.guestSessionId } }))
        .trialState,
    ).toBe('consumed');
    const download = await conversions.download({ kind: 'account', userId }, job.id, principal);
    download.body.destroy();
    expect(result.result?.userId).toBeNull();
  });
  it('terminal engine failure releases the guest reservation without retrying invalid bytes', async () => {
    const job = await accepted(true);
    calls.mockRejectedValueOnce(new EngineFailure('Synthetic failure.'));
    await processing.process(job.id);
    expect((await row(job.id)).status).toBe('failed');
    if (job.principal.kind !== 'guest') throw new Error('Expected guest.');
    expect(
      (
        await db.client.guestSession.findUniqueOrThrow({
          where: { id: job.principal.guestSessionId },
        })
      ).trialState,
    ).toBe('available');
    await processing.process(job.id);
    expect((await row(job.id)).attempts).toBe(1);
  });
  it('transient failures keep the guest reserved, use backoff and stop after three durable attempts', async () => {
    const job = await accepted(true);
    calls.mockRejectedValue(new Error('Transient synthetic failure.'));
    for (let attempt = 1; attempt <= 3; attempt++) {
      await retryNow(job.id);
      await processing.process(job.id);
      expect((await row(job.id)).attempts).toBe(attempt);
    }
    expect((await row(job.id)).status).toBe('failed');
  });
  it('recovers an expired lease and fences a late output from the old attempt', async () => {
    const job = await accepted(true);
    let release!: (buffer: Buffer) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    calls.mockImplementationOnce(() => {
      entered();
      return new Promise<Buffer>((resolve) => {
        release = resolve;
      });
    });
    const old = processing.process(job.id);
    await started;
    await db.client.conversion.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await processing.recover(await row(job.id));
    await retryNow(job.id);
    await processing.process(job.id);
    const published = await row(job.id);
    release(await sharp(jpg).png().toBuffer());
    await old;
    expect((await row(job.id)).resultFileId).toBe(published.resultFileId);
    expect(published.attempts).toBe(2);
  });
  it('reconciles durable queue loss and completes through the independent BullMQ consumer', async () => {
    const job = await accepted();
    const worker = new ConversionWorker(
      config,
      db,
      queue,
      { readiness: () => Promise.resolve({ status: 'ok' }) } as InfrastructureService,
      processing,
    );
    await worker.onApplicationBootstrap();
    try {
      const deadline = Date.now() + 10_000;
      while ((await row(job.id)).status !== 'completed' && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await row(job.id)).status).toBe('completed');
      await worker.check();
    } finally {
      await worker.beforeApplicationShutdown();
    }
  });
});
