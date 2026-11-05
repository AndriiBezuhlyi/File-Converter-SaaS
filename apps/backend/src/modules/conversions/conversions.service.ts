import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { QueueService } from '../../infrastructure/queue/queue.service.js';
import { bounded } from '../../infrastructure/dependency.js';
import type { Prisma, Conversion } from '../../generated/prisma/client.js';
import { AuthError } from '../auth/auth-error.js';
import { GuestTrialService } from '../auth/guest/guest-trial.service.js';
import { GUEST_ADMISSION_WINDOW_MS } from '../auth/guest/guest-config.js';
import type { ConversionPrincipal } from './conversion-boundary.js';
import type { GuestPrincipal } from '../auth/guest/guest.types.js';
import { INPUT_MIME } from './conversion-policy.js';
import { validateUpload, type StagedUpload } from './upload-validation.js';

const missing = () => new AuthError(404, 'NOT_FOUND', 'Conversion not found.');
const busy = () =>
  new AuthError(429, 'CONVERSION_CAPACITY_REACHED', 'Conversion capacity is temporarily full.');
const owner = (principal: ConversionPrincipal) =>
  principal.kind === 'guest'
    ? { guestSessionId: principal.guestSessionId, userId: null }
    : { userId: principal.userId, guestSessionId: null };

@Injectable()
export class ConversionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly trials: GuestTrialService,
  ) {}
  async preflight(principal: ConversionPrincipal) {
    if (principal.kind === 'guest') {
      const [guest] = await this.database.client.$queryRaw<
        { trialState: string; remaining: number }[]
      >`
        SELECT "trialState", EXTRACT(EPOCH FROM ("credentialExpiresAt" - clock_timestamp()))::float8 * 1000 AS remaining
        FROM "GuestSession" WHERE "id" = ${principal.guestSessionId}::uuid AND "tokenHash" = ${principal.tokenHash}`;
      if (!guest || guest.remaining < GUEST_ADMISSION_WINDOW_MS)
        throw new AuthError(
          401,
          'GUEST_CREDENTIAL_INVALID',
          'Sign in or refresh your guest context.',
        );
      if (guest.trialState === 'consumed')
        throw new AuthError(
          401,
          'GUEST_CONVERSION_LIMIT_REACHED',
          'Sign in to convert another file.',
        );
      if (guest.trialState === 'reserved')
        throw new AuthError(
          409,
          'GUEST_CONVERSION_IN_PROGRESS',
          'A guest conversion is already in progress.',
        );
    }
    await Promise.all([this.queue.check(), this.storage.check()]);
  }
  async create(principal: ConversionPrincipal, file: StagedUpload | undefined, body: unknown) {
    const input = await validateUpload(file, body);
    const objectKey = this.storage.createKey('inputs');
    const id = randomUUID();
    const stream = createReadStream(file!.path);
    try {
      await this.storage.put(objectKey, stream, INPUT_MIME[input.format], input.sizeBytes);
    } catch (error) {
      await this.storage.remove(objectKey).catch(() => undefined);
      throw error;
    } finally {
      stream.destroy();
    }
    let accepted: Conversion;
    try {
      accepted = await this.database.client.$transaction(
        async (tx) => {
          // Serialize admission counts across API replicas; no storage/queue IO under this lock.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(140014)`;
          const active = {
            status: { in: ['queued', 'processing'] as ('queued' | 'processing')[] },
          };
          if (
            (await tx.conversion.count({ where: active })) >= 1_000 ||
            (await tx.conversion.count({ where: { ...active, ...owner(principal) } })) >= 5
          )
            throw busy();
          const accept = async (transaction: Prisma.TransactionClient) => {
            const settings =
              principal.kind === 'guest'
                ? null
                : await transaction.userSettings.findUnique({
                    where: { userId: principal.userId },
                  });
            const source = await transaction.file.create({
              data: {
                ...owner(principal),
                objectKey,
                originalName: input.name,
                format: input.format,
                detectedMime: INPUT_MIME[input.format],
                sizeBytes: BigInt(input.sizeBytes),
                purpose: 'input',
                retention: 'temporary',
              },
            });
            const conversion = await transaction.conversion.create({
              data: {
                id,
                ...owner(principal),
                sourceFileId: source.id,
                sourceFormat: input.format,
                targetFormat: input.target,
                saveResult: settings?.autoSave ?? false,
              },
            });
            await transaction.backgroundTask.create({
              data: {
                type: 'conversion_dispatch',
                resourceId: id,
                deduplicationKey: `conversion:${id}`,
              },
            });
            return conversion;
          };
          return principal.kind === 'guest'
            ? this.trials.reserve(tx, principal, accept)
            : accept(tx);
        },
        { timeout: 5_000, maxWait: 5_000 },
      );
    } catch (error) {
      // A lost COMMIT acknowledgement is ambiguous. Never delete an accepted job's source.
      const committed = await this.database.client.conversion
        .findUnique({ where: { id } })
        .catch(() => undefined);
      if (committed) accepted = committed;
      else {
        if (committed === null) await this.storage.remove(objectKey).catch(() => undefined);
        throw error;
      }
    }
    try {
      await bounded(
        this.queue.queue.add(
          'convert',
          { conversionId: id },
          {
            jobId: id,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: { age: 3_600, count: 1_000 },
            removeOnFail: { age: 3_600, count: 1_000 },
          },
        ),
        5_000,
      );
      // Keep the intent pending until the worker dispatcher can reconcile acknowledgement/queue loss.
    } catch {
      /* Durable acceptance survives a queue outage; the worker reconciles this intent. */
    }
    return { ...this.describe(accepted), status: 'queued' as const };
  }
  private describe(conversion: Conversion) {
    return {
      id: conversion.id,
      status: conversion.status,
      sourceFormat: conversion.sourceFormat,
      targetFormat: conversion.targetFormat,
      createdAt: conversion.createdAt.toISOString(),
      saveResult: conversion.saveResult,
    };
  }
  async download(principal: ConversionPrincipal, id: string, retainedGuest?: GuestPrincipal) {
    const status = await this.status(principal, id, retainedGuest);
    if (status.status !== 'completed' || !status.result) throw missing();
    if (status.resultAvailability !== 'available')
      throw new AuthError(410, 'RESULT_UNAVAILABLE', 'Conversion result is no longer available.');
    const result = await this.database.client.file.findUniqueOrThrow({
      where: { id: status.result.id },
    });
    const object = await this.storage.get(result.objectKey);
    return {
      ...object,
      name: result.originalName,
      mime: result.detectedMime,
      size: Number(result.sizeBytes),
    };
  }
  async status(principal: ConversionPrincipal, id: string, retainedGuest?: GuestPrincipal) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
      throw missing();
    return this.database.client.$transaction(async (tx) => {
      let conversion: Conversion | null = null;
      if (principal.kind !== 'guest')
        conversion = await tx.conversion.findFirst({ where: { id, ...owner(principal) } });
      const guest =
        principal.kind === 'guest'
          ? principal
          : principal.kind === 'account'
            ? retainedGuest
            : undefined;
      if (!conversion && guest) conversion = await this.trials.ownedConversion(tx, guest, id);
      if (!conversion) throw missing();
      const result = conversion.resultFileId
        ? await tx.file.findFirst({
            where: {
              id: conversion.resultFileId,
              userId: conversion.userId,
              guestSessionId: conversion.guestSessionId,
              purpose: 'output',
            },
          })
        : null;
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const now = clock!.now;
      const availability =
        conversion.status !== 'completed'
          ? 'pending'
          : !result || result.deletedAt || result.storageDeletionState !== 'present'
            ? 'deleted'
            : result.expiresAt && result.expiresAt <= now
              ? 'expired'
              : 'available';
      return {
        ...this.describe(conversion),
        completedAt: conversion.completedAt?.toISOString() ?? null,
        error:
          conversion.status === 'failed'
            ? { code: 'CONVERSION_FAILED', message: 'Conversion failed. Please try another file.' }
            : null,
        result: result
          ? {
              id: result.id,
              owner: result.guestSessionId ? ('guest' as const) : ('account' as const),
              name: result.originalName,
              format: result.format,
              sizeBytes: Number(result.sizeBytes),
              retention: result.retention,
              expiresAt: result.expiresAt?.toISOString() ?? null,
              availability,
            }
          : null,
        resultAvailability: conversion.status === 'failed' ? 'unavailable' : availability,
      };
    });
  }
}
