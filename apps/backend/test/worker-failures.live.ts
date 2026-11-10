import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { StorageService } from '../src/infrastructure/storage/storage.service.js';
import { validateInfrastructureEnvironment } from '../src/infrastructure/config/infrastructure-config.js';
import { GuestTrialService } from '../src/modules/auth/guest/guest-trial.service.js';
import { ConversionProcessingService } from '../src/modules/conversions/conversion-processing.service.js';
import { ConversionEngine } from '../src/modules/conversions/conversion-engine.js';
import { CleanupService } from '../src/modules/files/cleanup.service.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';

const database = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
if (
  database.hostname !== '127.0.0.1' ||
  database.protocol !== 'postgresql:' ||
  database.search ||
  !/^\/converter_test_[a-z0-9_]+$/.test(database.pathname)
)
  throw new Error('Explicit disposable loopback database required.');

it.each(['storage acknowledgement', 'publication acknowledgement'])(
  'retains one guest success and cleans attempt objects after lost %s',
  async (fault) => {
    const servers = await infrastructureServers();
    const directory = await mkdtemp(join(tmpdir(), 'worker-fault-'));
    const config = validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: database.href,
      S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
      SMTP_PORT: servers.smtpPort,
      WORKER_TEMP_DIR: directory,
    });
    const db = new DatabaseService(config);
    const storage = new StorageService(config);
    const trials = new GuestTrialService();
    const engine = new ConversionEngine();
    const processing = new ConversionProcessingService(db, storage, trials, engine, config);
    const cleanup = new CleanupService(db, storage, config);
    const guestSessionId = randomUUID();
    const tokenHash = randomUUID();
    const id = randomUUID();
    const key = storage.createKey('inputs');
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const convert = jest
      .spyOn(engine, 'convert')
      .mockResolvedValue(await sharp(png).jpeg().toBuffer());
    try {
      await db.start();
      await storage.start();
      await storage.put(key, png, 'image/png', png.length);
      await db.client.guestSession.create({
        data: {
          id: guestSessionId,
          tokenHash,
          credentialExpiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      await db.client.$transaction(async (tx) => {
        await trials.reserve(tx, { kind: 'guest', guestSessionId, tokenHash }, async () => {
          const source = await tx.file.create({
            data: {
              guestSessionId,
              objectKey: key,
              originalName: 'owned.png',
              format: 'png',
              detectedMime: 'image/png',
              sizeBytes: BigInt(png.length),
              purpose: 'input',
            },
          });
          const conversion = await tx.conversion.create({
            data: {
              id,
              guestSessionId,
              sourceFileId: source.id,
              sourceFormat: 'png',
              targetFormat: 'jpg',
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
        });
      });
      const put = storage.put.bind(storage);
      const transaction = db.client.$transaction.bind(db.client);
      const storageFault =
        fault === 'storage acknowledgement'
          ? jest.spyOn(storage, 'put').mockImplementationOnce(async (...args) => {
              await put(...args);
              throw new Error('Synthetic lost storage acknowledgement.');
            })
          : undefined;
      // Claim transaction succeeds; publication commits, then its response is lost.
      const publicationFault =
        fault === 'publication acknowledgement'
          ? jest
              .spyOn(db.client, '$transaction')
              .mockImplementationOnce((work, options) => transaction(work, options))
              .mockImplementationOnce(async (work, options) => {
                await transaction(work, options);
                throw new Error('Synthetic lost publication acknowledgement.');
              })
          : undefined;
      try {
        await processing.process(id);
      } finally {
        storageFault?.mockRestore();
        publicationFault?.mockRestore();
      }
      if (fault === 'storage acknowledgement') {
        expect((await db.client.conversion.findUniqueOrThrow({ where: { id } })).status).toBe(
          'queued',
        );
        expect(
          (await db.client.guestSession.findUniqueOrThrow({ where: { id: guestSessionId } }))
            .trialState,
        ).toBe('reserved');
        expect(
          [...servers.objects.keys()].filter((value) => value.startsWith('outputs/')),
        ).toHaveLength(0);
        await db.client.backgroundTask.update({
          where: { deduplicationKey: `conversion:${id}` },
          data: { availableAt: new Date(0) },
        });
        await processing.process(id);
      }
      await processing.process(id);
      const result = await db.client.conversion.findUniqueOrThrow({
        where: { id },
        include: { result: true },
      });
      expect(result.status).toBe('completed');
      expect(
        (await db.client.guestSession.findUniqueOrThrow({ where: { id: guestSessionId } }))
          .trialState,
      ).toBe('consumed');
      expect(await db.client.file.count({ where: { guestSessionId, purpose: 'output' } })).toBe(1);
      expect(servers.objects.has(result.result!.objectKey)).toBe(true);
      await cleanup.deletions();
      expect(servers.objects.has(key)).toBe(false);
      expect(servers.objects.size).toBe(1);
      expect(await readdir(directory)).toEqual([]);
      expect(convert).toHaveBeenCalledTimes(fault === 'storage acknowledgement' ? 2 : 1);
    } finally {
      convert.mockRestore();
      await db.client.guestSession.updateMany({
        where: { id: guestSessionId, trialState: 'reserved' },
        data: { trialState: 'available', reservedConversionId: null },
      });
      const files = await db.client.file.findMany({
        where: { guestSessionId },
        select: { id: true },
      });
      await db.client.backgroundTask.deleteMany({
        where: { resourceId: { in: [id, ...files.map((file) => file.id)] } },
      });
      await db.client.conversion.deleteMany({ where: { id } });
      await db.client.file.deleteMany({ where: { guestSessionId } });
      await db.client.guestSession.deleteMany({ where: { id: guestSessionId } });
      await db.stop();
      storage.stop();
      await servers.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
