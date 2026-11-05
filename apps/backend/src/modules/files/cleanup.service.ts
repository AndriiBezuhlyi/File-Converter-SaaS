import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readdir, lstat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import {
  INFRA_CONFIG,
  type InfrastructureEnvironment,
} from '../../infrastructure/config/infrastructure-config.js';

const SWEEP_ID = '00000000-0000-4000-8000-000000000016';
const HOUR = 3_600_000;
@Injectable()
export class CleanupService {
  private stopping = false;
  stop() {
    this.stopping = true;
  }
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    @Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment,
  ) {}
  async sweep() {
    if (this.stopping) return;
    // Scratch belongs to each host, independently of the global database sweep leader.
    await this.scratch();
    const token = randomUUID();
    await this.database.client.backgroundTask.upsert({
      where: { deduplicationKey: 'cleanup:sweep' },
      create: { type: 'cleanup_sweep', resourceId: SWEEP_ID, deduplicationKey: 'cleanup:sweep' },
      update: {},
    });
    const claimed = await this.database.client.$executeRaw`
      UPDATE "BackgroundTask" SET "leaseToken" = ${token}::uuid,
      "leaseExpiresAt" = clock_timestamp() + interval '5 minutes'
      WHERE "deduplicationKey" = 'cleanup:sweep' AND "availableAt" <= clock_timestamp()
      AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= clock_timestamp())`;
    if (!claimed) return;
    try {
      await this.schedule(token);
      await this.deletions(token);
      if (await this.renew(token)) await this.orphans(token);
    } finally {
      await this.database.client.backgroundTask.updateMany({
        where: { deduplicationKey: 'cleanup:sweep', leaseToken: token },
        data: {
          leaseToken: null,
          leaseExpiresAt: null,
          availableAt: new Date(Date.now() + 30_000),
        },
      });
    }
  }
  private async renew(token: string) {
    if (this.stopping) return false;
    return Boolean(
      await this.database.client.$executeRaw`
      UPDATE "BackgroundTask" SET "leaseExpiresAt" = clock_timestamp() + interval '5 minutes'
      WHERE "deduplicationKey" = 'cleanup:sweep' AND "leaseToken" = ${token}::uuid
      AND "leaseExpiresAt" > clock_timestamp()`,
    );
  }
  private async schedule(token: string) {
    const files = await this.database.client.file.findMany({
      where: {
        storageDeletionState: { not: 'deleted' },
        OR: [
          { deletedAt: { not: null } },
          { retention: 'temporary', expiresAt: { lte: new Date() } },
          { purpose: 'input', sourceFor: { status: { in: ['completed', 'failed'] } } },
        ],
      },
      orderBy: { id: 'asc' },
      take: 100,
    });
    for (const file of files) {
      if (!(await this.renew(token))) return;
      await this.database.client.$transaction(async (tx) => {
        await tx.file.updateMany({
          where: { id: file.id, storageDeletionState: 'present' },
          data: { deletedAt: file.deletedAt ?? new Date(), storageDeletionState: 'pending' },
        });
        await tx.backgroundTask.upsert({
          where: { deduplicationKey: `delete:${file.id}` },
          create: {
            type: 'file_deletion',
            resourceId: file.id,
            deduplicationKey: `delete:${file.id}`,
          },
          update: {},
        });
        await tx.backgroundTask.updateMany({
          where: { deduplicationKey: `delete:${file.id}`, completedAt: { not: null } },
          data: { completedAt: null },
        });
      });
    }
  }
  async deletions(sweepToken?: string) {
    const tasks = await this.database.client.backgroundTask.findMany({
      where: {
        type: 'file_deletion',
        completedAt: null,
        availableAt: { lte: new Date() },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
      },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    for (const task of tasks) {
      if (this.stopping) return;
      if (sweepToken && !(await this.renew(sweepToken))) return;
      const token = randomUUID();
      const key = await this.database.client.$transaction(async (tx) => {
        const claimed = await tx.$executeRaw`
          UPDATE "BackgroundTask" SET "leaseToken" = ${token}::uuid,
          "leaseExpiresAt" = clock_timestamp() + interval '5 minutes', "attempts" = "attempts" + 1
          WHERE id = ${task.id}::uuid AND "completedAt" IS NULL
          AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= clock_timestamp())`;
        if (!claimed) return;
        const payload = task.payload;
        const objectKey =
          payload &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          typeof payload.objectKey === 'string'
            ? payload.objectKey
            : undefined;
        const file = objectKey
          ? await tx.file.findUnique({ where: { objectKey } })
          : await tx.file.findUnique({ where: { id: task.resourceId } });
        if (file && file.storageDeletionState !== 'present' && file.deletedAt)
          return file.objectKey;
        if (!file && objectKey && /^(inputs|outputs)\/[a-f0-9-]{36}$/.test(objectKey))
          return objectKey;
        await tx.backgroundTask.update({
          where: { id: task.id },
          data: { completedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
        });
      });
      if (!key) continue;
      try {
        await this.storage.remove(key);
        await this.database.client.$transaction(async (tx) => {
          // The tombstone stays durable even if the physical deletion is repeated after a crash.
          await tx.file.updateMany({
            where: { objectKey: key, storageDeletionState: 'pending' },
            data: { storageDeletionState: 'deleted', storageDeletedAt: new Date() },
          });
          await tx.backgroundTask.updateMany({
            where: { id: task.id, leaseToken: token },
            data: {
              completedAt: new Date(),
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
            },
          });
        });
      } catch {
        await this.database.client.backgroundTask.updateMany({
          where: { id: task.id, leaseToken: token },
          data: {
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: 'STORAGE_DELETE_FAILED',
            availableAt: new Date(
              Date.now() + Math.min(HOUR, 1_000 * 2 ** Math.min(task.attempts, 12)),
            ),
          },
        });
      }
    }
  }
  private async orphans(token: string) {
    const sweep = await this.database.client.backgroundTask.findUniqueOrThrow({
      where: { deduplicationKey: 'cleanup:sweep' },
    });
    const payload = sweep.payload;
    const state = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const prefix = state.prefix === 'outputs/' ? 'outputs/' : 'inputs/';
    const page = await this.storage.list(
      prefix,
      typeof state.cursor === 'string' ? state.cursor : undefined,
    );
    for (const object of page.items) {
      if (!(await this.renew(token))) return;
      if (object.modifiedAt.getTime() > Date.now() - HOUR) continue;
      const file = await this.database.client.file.findUnique({ where: { objectKey: object.key } });
      if (file && file.storageDeletionState !== 'deleted') continue;
      // Producers create this exact intent before uploading and fence acceptance/publication on it.
      await this.database.client.backgroundTask.upsert({
        where: { deduplicationKey: `unpublished:${object.key}` },
        create: {
          type: 'file_deletion',
          resourceId: randomUUID(),
          deduplicationKey: `unpublished:${object.key}`,
          payload: { objectKey: object.key },
        },
        update: { completedAt: null },
      });
    }
    await this.database.client.backgroundTask.updateMany({
      where: { id: sweep.id, leaseToken: token },
      data: {
        payload: page.cursor
          ? { prefix, cursor: page.cursor }
          : { prefix: prefix === 'inputs/' ? 'outputs/' : 'inputs/' },
      },
    });
  }
  private async scratch() {
    const root = resolve(this.config.WORKER_TEMP_DIR);
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (this.stopping) return;
      if (!entry.isDirectory() || !/^attempt-[a-zA-Z0-9]+$/.test(entry.name)) continue;
      const path = resolve(join(root, entry.name));
      if (!path.startsWith(root + '\\') && !path.startsWith(root + '/')) continue;
      const stat = await lstat(path).catch(() => null);
      if (stat && !stat.isSymbolicLink() && stat.mtimeMs < Date.now() - HOUR)
        await rm(path, { recursive: true, force: true });
    }
  }
}
