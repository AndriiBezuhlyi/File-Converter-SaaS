import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { createClient } from 'redis';
import {
  INFRA_CONFIG,
  type InfrastructureEnvironment,
} from '../../infrastructure/config/infrastructure-config.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { QueueService, CONVERSION_QUEUE } from '../../infrastructure/queue/queue.service.js';
import { InfrastructureService } from '../../infrastructure/infrastructure.service.js';
import { bounded } from '../../infrastructure/dependency.js';
import { ConversionProcessingService } from './conversion-processing.service.js';

@Injectable()
export class ConversionWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly connection;
  private worker?: Worker<{ conversionId: string }>;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private stopping = false;
  private healthy = false;
  constructor(
    @Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment,
    private readonly database: DatabaseService,
    private readonly queue: QueueService,
    private readonly infrastructure: InfrastructureService,
    private readonly processing: ConversionProcessingService,
  ) {
    this.connection = createClient({
      url: config.REDIS_URL,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: config.INFRA_TIMEOUT_MS,
        reconnectStrategy: (attempt) => Math.min(250 * (attempt + 1), 2_000),
      },
    });
    this.connection.on('error', () =>
      Logger.warn('Conversion queue unavailable.', 'ConversionWorker'),
    );
  }
  async onApplicationBootstrap() {
    if ((await this.infrastructure.readiness()).status !== 'ok')
      throw new Error('Worker infrastructure not ready.');
    try {
      await this.processing.check();
      await bounded(this.connection.connect(), this.config.INFRA_TIMEOUT_MS);
      this.worker = new Worker<{ conversionId: string }>(
        CONVERSION_QUEUE,
        async (job) => {
          if (typeof job.data.conversionId === 'string')
            await this.processing.process(job.data.conversionId);
        },
        {
          connection: this.connection,
          prefix: `${this.config.REDIS_NAMESPACE}:queue`,
          concurrency: 1,
          lockDuration: 120_000,
          maxStalledCount: 1,
        },
      );
      this.worker.on('error', () =>
        Logger.warn('Conversion worker unavailable.', 'ConversionWorker'),
      );
      this.worker.on('failed', () =>
        Logger.warn('Conversion delivery failed.', 'ConversionWorker'),
      );
      this.worker.on('stalled', () =>
        Logger.warn('Conversion delivery stalled.', 'ConversionWorker'),
      );
      await bounded(this.worker.waitUntilReady(), this.config.INFRA_TIMEOUT_MS);
      await this.tick();
    } catch {
      await this.beforeApplicationShutdown();
      throw new Error('Conversion worker startup failed.');
    }
  }
  private async tick() {
    if (this.stopping) return;
    this.pending = this.dispatch();
    try {
      await this.pending;
      this.healthy = true;
    } catch {
      this.healthy = false;
      Logger.warn('Conversion reconciliation unavailable.', 'ConversionWorker');
    } finally {
      if (!this.stopping)
        this.timer = setTimeout(() => {
          void this.tick();
        }, 2_000);
    }
  }
  private async dispatch() {
    const expired = await this.database.client.conversion.findMany({
      where: { status: 'processing', leaseExpiresAt: { lte: new Date() } },
      orderBy: [{ leaseExpiresAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    for (const conversion of expired) {
      if (this.stopping) return;
      await this.processing.recover(conversion);
    }
    const tasks = await this.database.client.backgroundTask.findMany({
      where: { type: 'conversion_dispatch', completedAt: null, availableAt: { lte: new Date() } },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    for (const task of tasks) {
      if (this.stopping) return;
      const conversion = await this.database.client.conversion.findUnique({
        where: { id: task.resourceId },
      });
      if (!conversion || conversion.status === 'completed' || conversion.status === 'failed') {
        await this.database.client.backgroundTask.update({
          where: { id: task.id },
          data: { completedAt: new Date() },
        });
        continue;
      }
      if (conversion.status !== 'queued') continue;
      const jobId = `${conversion.id}-${conversion.processingVersion}`;
      const existing = await this.queue.queue.getJob(jobId);
      if (existing && ['completed', 'failed'].includes(await existing.getState()))
        await existing.remove();
      await this.queue.queue.add(
        'convert',
        { conversionId: conversion.id },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 3_600, count: 1_000 },
        },
      );
    }
  }
  async check() {
    if (this.stopping || !this.healthy || !this.connection.isReady || !this.worker?.isRunning())
      throw new Error('Conversion worker unavailable.');
    await bounded(this.connection.ping(), this.config.INFRA_TIMEOUT_MS);
  }
  async beforeApplicationShutdown() {
    this.stopping = true;
    clearTimeout(this.timer);
    try {
      await bounded(this.pending ?? Promise.resolve(), this.config.INFRA_TIMEOUT_MS).catch(
        () => {},
      );
      if (this.worker) await bounded(this.worker.close(), this.config.SHUTDOWN_TIMEOUT_MS - 1_000);
    } finally {
      if (this.connection.isOpen) this.connection.destroy();
    }
  }
}
