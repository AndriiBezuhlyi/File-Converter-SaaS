import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Conversion, Prisma } from '../../generated/prisma/client.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import {
  INFRA_CONFIG,
  type InfrastructureEnvironment,
} from '../../infrastructure/config/infrastructure-config.js';
import { GuestTrialService } from '../auth/guest/guest-trial.service.js';
import { ConversionEngine, EngineFailure } from './conversion-engine.js';
import { MAX_UPLOAD_BYTES, type SourceFormat, type TargetFormat } from './conversion-policy.js';

const LEASE_MS = 120_000;
const WINDOW_MS = 3_600_000;
const MIME = { jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' } as const;

@Injectable()
export class ConversionProcessingService {
  check() {
    return this.engine.check();
  }
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly trials: GuestTrialService,
    private readonly engine: ConversionEngine,
    @Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment,
  ) {}

  // GuestSession always precedes Conversion in lock order. IO never runs under these locks.
  private async transition<T>(
    snapshot: Conversion,
    expired: boolean,
    work: (tx: Prisma.TransactionClient, current: Conversion, now: Date) => Promise<T>,
  ) {
    return this.database.client.$transaction(async (tx) => {
      const apply = async (transaction: Prisma.TransactionClient) => {
        const current = await transaction.conversion.findUniqueOrThrow({
          where: { id: snapshot.id },
        });
        const [clock] = await transaction.$queryRaw<
          { now: Date }[]
        >`SELECT clock_timestamp() AS now`;
        const now = clock!.now;
        if (
          current.status !== snapshot.status ||
          current.processingVersion !== snapshot.processingVersion ||
          current.leaseToken !== snapshot.leaseToken ||
          (current.status === 'processing' &&
            (!current.leaseExpiresAt ||
              (expired ? current.leaseExpiresAt > now : current.leaseExpiresAt <= now)))
        )
          return;
        const value = await work(transaction, current, now);
        if (!expired && current.status === 'processing') {
          const [finished] = await transaction.$queryRaw<
            { now: Date }[]
          >`SELECT clock_timestamp() AS now`;
          if (current.leaseExpiresAt! <= finished!.now)
            throw new Error('Processing lease expired.');
        }
        return value;
      };
      if (snapshot.guestSessionId) {
        return expired
          ? this.trials.reconcileExpired(tx, snapshot.guestSessionId, snapshot.id, snapshot, apply)
          : this.trials.settle(tx, snapshot.guestSessionId, snapshot.id, snapshot, apply);
      }
      await tx.$queryRaw`SELECT id FROM "Conversion" WHERE id = ${snapshot.id}::uuid FOR UPDATE`;
      return apply(tx);
    });
  }

  private async terminal(
    tx: Prisma.TransactionClient,
    current: Conversion,
    now: Date,
    errorCode: string,
  ) {
    await tx.conversion.update({
      where: { id: current.id },
      data: {
        status: 'failed',
        failedAt: now,
        errorCode,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    await this.finishIntent(tx, current.id, now);
    await this.scheduleInputDeletion(tx, current.sourceFileId, now);
  }
  private async finishIntent(tx: Prisma.TransactionClient, id: string, now: Date) {
    await tx.backgroundTask.updateMany({
      where: { type: 'conversion_dispatch', resourceId: id },
      data: { completedAt: now, leaseToken: null, leaseExpiresAt: null },
    });
  }
  private async scheduleInputDeletion(tx: Prisma.TransactionClient, id: string, now: Date) {
    await tx.file.update({
      where: { id },
      data: { deletedAt: now, storageDeletionState: 'pending' },
    });
    await tx.backgroundTask.upsert({
      where: { deduplicationKey: `delete:${id}` },
      create: { type: 'file_deletion', resourceId: id, deduplicationKey: `delete:${id}` },
      update: {},
    });
  }

  async recover(snapshot: Conversion) {
    if (snapshot.status !== 'processing') return;
    await this.transition(snapshot, true, async (tx, current, now) => {
      if (current.attempts >= 3) return this.terminal(tx, current, now, 'ATTEMPTS_EXHAUSTED');
      await this.requeue(tx, current, now);
    });
  }
  private async requeue(tx: Prisma.TransactionClient, current: Conversion, now: Date) {
    await tx.conversion.update({
      where: { id: current.id },
      data: {
        status: 'queued',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    await tx.backgroundTask.updateMany({
      where: { type: 'conversion_dispatch', resourceId: current.id },
      data: { availableAt: new Date(now.getTime() + 1_000 * 2 ** current.attempts) },
    });
  }

  async process(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return;
    const snapshot = await this.database.client.conversion.findUnique({ where: { id } });
    if (!snapshot || snapshot.status !== 'queued') return;
    const attempt = await this.transition(snapshot, false, async (tx, current, now) => {
      const intent = await tx.backgroundTask.findUnique({
        where: { deduplicationKey: `conversion:${id}` },
      });
      if (!intent || intent.completedAt || intent.availableAt > now) return;
      const guest = current.guestSessionId
        ? await tx.guestSession.findUniqueOrThrow({ where: { id: current.guestSessionId } })
        : null;
      if (
        current.attempts >= 3 ||
        (guest && guest.credentialExpiresAt.getTime() < now.getTime() + WINDOW_MS + LEASE_MS)
      ) {
        await this.terminal(tx, current, now, 'ATTEMPTS_EXHAUSTED');
        return;
      }
      return tx.conversion.update({
        where: { id },
        data: {
          status: 'processing',
          attempts: { increment: 1 },
          processingVersion: { increment: 1 },
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          startedAt: now,
        },
      });
    });
    if (!attempt) return;
    let directory: string | undefined;
    let outputKey: string | undefined;
    let deletionId: string | undefined;
    let publicationAmbiguous = false;
    try {
      await mkdir(this.config.WORKER_TEMP_DIR, { recursive: true, mode: 0o700 });
      directory = await mkdtemp(join(this.config.WORKER_TEMP_DIR, 'attempt-'));
      const source = await this.database.client.file.findUniqueOrThrow({
        where: { id: attempt.sourceFileId },
      });
      const input = await this.storage.get(source.objectKey);
      let received = 0;
      await pipeline(
        input.body,
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            received += chunk.length;
            done(received > MAX_UPLOAD_BYTES ? new EngineFailure('Input limit.') : null, chunk);
          },
        }),
        createWriteStream(join(directory, 'input'), { flags: 'wx', mode: 0o600 }),
        { signal: AbortSignal.timeout(15_000) },
      );
      if (received !== Number(source.sizeBytes)) throw new EngineFailure('Input size mismatch.');
      const output = await this.engine.convert(
        join(directory, 'input'),
        attempt.sourceFormat as SourceFormat,
        attempt.targetFormat as TargetFormat,
      );
      outputKey = this.storage.createKey('outputs');
      // Persist a cleanup intent BEFORE storage IO. Crash or ambiguous commits leave recoverable objects.
      const deletion = await this.database.client.backgroundTask.create({
        data: {
          type: 'file_deletion',
          resourceId: id,
          deduplicationKey: `unpublished:${outputKey}`,
          payload: { objectKey: outputKey },
          availableAt: new Date(Date.now() + LEASE_MS * 2),
        },
      });
      deletionId = deletion.id;
      const target = attempt.targetFormat as TargetFormat;
      await this.storage.put(outputKey, output, MIME[target], output.length);
      const key = outputKey;
      publicationAmbiguous = true;
      await this.transition(attempt, false, async (tx, current, now) => {
        await tx.$queryRaw`SELECT id FROM "BackgroundTask" WHERE id = ${deletion.id}::uuid FOR UPDATE`;
        const intent = await tx.backgroundTask.findUniqueOrThrow({ where: { id: deletion.id } });
        if (intent.completedAt || intent.leaseToken)
          throw new Error('Output cleanup already claimed.');
        const result = await tx.file.create({
          data: {
            userId: current.userId,
            guestSessionId: current.guestSessionId,
            objectKey: key,
            originalName: `${source.originalName.replace(/\.[^.]*$/, '')}.${target}`,
            format: target,
            detectedMime: MIME[target],
            sizeBytes: BigInt(output.length),
            purpose: 'output',
            retention: current.saveResult ? 'saved' : 'temporary',
            expiresAt: current.saveResult ? null : new Date(now.getTime() + WINDOW_MS),
          },
        });
        await tx.conversion.update({
          where: { id },
          data: {
            status: 'completed',
            resultFileId: result.id,
            completedAt: now,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        await tx.backgroundTask.update({ where: { id: deletion.id }, data: { completedAt: now } });
        await this.finishIntent(tx, id, now);
        await this.scheduleInputDeletion(tx, current.sourceFileId, now);
      });
      publicationAmbiguous = false;
    } catch (error) {
      // A failed COMMIT response may still mean success. Fencing prevents changing a terminal record.
      await this.transition(attempt, false, async (tx, current, now) => {
        if (error instanceof EngineFailure || current.attempts >= 3)
          await this.terminal(
            tx,
            current,
            now,
            error instanceof EngineFailure ? 'ENGINE_FAILED' : 'ATTEMPTS_EXHAUSTED',
          );
        else await this.requeue(tx, current, now);
      }).catch(() => undefined);
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
      if (outputKey && deletionId && !publicationAmbiguous) {
        const cleanupId = deletionId;
        // Never delete after an ambiguous database read/commit. The durable intent survives instead.
        const intent = await this.database.client.backgroundTask
          .findUnique({ where: { id: deletionId } })
          .catch(() => undefined);
        if (intent && !intent.completedAt) {
          const published = await this.database.client.file
            .findUnique({ where: { objectKey: outputKey } })
            .catch(() => undefined);
          if (published === null) {
            await this.storage
              .remove(outputKey)
              .then(async () => {
                await this.database.client.backgroundTask.update({
                  where: { id: cleanupId },
                  data: { completedAt: new Date() },
                });
              })
              .catch(() => undefined);
          }
        }
      }
    }
  }
}
