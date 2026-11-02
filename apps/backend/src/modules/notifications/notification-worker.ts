import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { createClient } from 'redis';
import {
  INFRA_CONFIG,
  type InfrastructureEnvironment,
} from '../../infrastructure/config/infrastructure-config.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { InfrastructureService } from '../../infrastructure/infrastructure.service.js';
import { bounded } from '../../infrastructure/dependency.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';

export const NOTIFICATION_QUEUE = 'notifications';
@Injectable()
export class NotificationWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly connection;
  private queue?: Queue<{ taskId: string }>;
  private worker?: Worker<{ taskId: string }>;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private stopping = false;
  private dispatchHealthy = false;
  constructor(
    @Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment,
    private readonly database: DatabaseService,
    private readonly infrastructure: InfrastructureService,
    private readonly delivery: NotificationDeliveryService,
  ) {
    this.connection = createClient({
      url: config.REDIS_URL,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1_000,
      socket: {
        connectTimeout: config.INFRA_TIMEOUT_MS,
        reconnectStrategy: (attempt) => Math.min(250 * (attempt + 1), 2_000),
      },
    });
    this.connection.on('error', () =>
      Logger.warn('Notification queue unavailable.', 'NotificationWorker'),
    );
  }
  async onApplicationBootstrap() {
    // Dependency module hooks run first. Never consume while shared infrastructure is unready.
    if ((await this.infrastructure.readiness()).status !== 'ok')
      throw new Error('Notification infrastructure is not ready.');
    try {
      await bounded(this.connection.connect(), this.config.INFRA_TIMEOUT_MS);
      const options = {
        connection: this.connection,
        prefix: `${this.config.REDIS_NAMESPACE}:queue`,
      };
      this.queue = new Queue<{ taskId: string }>(NOTIFICATION_QUEUE, options);
      this.worker = new Worker<{ taskId: string }>(
        NOTIFICATION_QUEUE,
        async (job) => {
          const taskId: unknown = job.data.taskId;
          if (
            typeof taskId !== 'string' ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(taskId)
          )
            throw new Error('Invalid notification reference.');
          await this.delivery.deliver(taskId);
        },
        { ...options, concurrency: 2, lockDuration: 60_000 },
      );
      this.queue.on('error', () =>
        Logger.warn('Notification queue unavailable.', 'NotificationWorker'),
      );
      this.worker.on('error', () =>
        Logger.warn('Notification worker unavailable.', 'NotificationWorker'),
      );
      this.worker.on('failed', () =>
        Logger.warn('Notification attempt failed.', 'NotificationWorker'),
      );
      await bounded(
        Promise.all([this.queue.waitUntilReady(), this.worker.waitUntilReady()]),
        this.config.INFRA_TIMEOUT_MS,
      );
      await this.tick();
    } catch {
      await this.beforeApplicationShutdown();
      throw new Error('Notification worker startup failed.');
    }
  }
  private async tick() {
    if (this.stopping) return;
    this.pending = this.dispatch();
    try {
      await this.pending;
      this.dispatchHealthy = true;
    } catch {
      this.dispatchHealthy = false;
      Logger.warn('Notification dispatch unavailable.', 'NotificationWorker');
    } finally {
      if (!this.stopping)
        this.timer = setTimeout(() => {
          void this.tick();
        }, 5_000);
    }
  }
  private async dispatch() {
    const now = new Date();
    const tasks = await this.database.client.backgroundTask.findMany({
      where: {
        type: 'email_notification',
        completedAt: null,
        attempts: { lt: 5 },
        availableAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      select: { id: true, attempts: true },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    for (const task of tasks) {
      if (this.stopping) break;
      const existing = await this.queue!.getJob(`${task.id}-${task.attempts}`);
      if (existing) {
        const state = await existing.getState();
        if (state === 'completed' || state === 'failed') await existing.remove();
      }
      await this.queue!.add(
        'deliver',
        { taskId: task.id },
        {
          jobId: `${task.id}-${task.attempts}`,
          attempts: 1,
          removeOnComplete: { age: 86_400, count: 1_000 },
          removeOnFail: { age: 86_400, count: 1_000 },
        },
      );
    }
  }
  async check() {
    if (
      this.stopping ||
      !this.dispatchHealthy ||
      !this.connection.isReady ||
      !this.worker?.isRunning()
    )
      throw new Error('Notification worker unavailable.');
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
      if (this.queue) await bounded(this.queue.close(), this.config.INFRA_TIMEOUT_MS);
    } finally {
      if (this.connection.isOpen) this.connection.destroy();
    }
  }
}
