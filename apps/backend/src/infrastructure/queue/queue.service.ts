import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createClient } from 'redis';
import { INFRA_CONFIG, type InfrastructureEnvironment } from '../config/infrastructure-config.js';
import { bounded, type InfrastructureDependency } from '../dependency.js';

export const CONVERSION_QUEUE = 'conversions';

@Injectable()
export class QueueService implements InfrastructureDependency {
  private instance: Queue | undefined;
  private readonly connection;
  constructor(@Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment) {
    this.connection = createClient({
      url: config.REDIS_URL,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1_000,
      socket: {
        connectTimeout: config.INFRA_TIMEOUT_MS,
        reconnectStrategy: (attempt) => Math.min(250 * (attempt + 1), 2_000),
      },
    });
    this.connection.on('error', () => Logger.warn('Queue connection unavailable.', 'QueueService'));
  }

  get queue(): Queue {
    if (!this.instance) throw new Error('Queue is not initialized.');
    return this.instance;
  }
  async start() {
    // BullMQ 6 accepts node-redis directly; keep its connection separate from sessions.
    await this.connection.connect();
    this.instance = new Queue(CONVERSION_QUEUE, {
      prefix: `${this.config.REDIS_NAMESPACE}:queue`,
      connection: this.connection,
    });
    this.instance.on('error', () => Logger.warn('Queue connection unavailable.', 'QueueService'));
    await bounded(this.instance.waitUntilReady(), this.config.INFRA_TIMEOUT_MS);
    await this.check();
  }
  async check() {
    if (!this.connection.isReady) throw new Error('Queue is not ready.');
    await bounded(this.connection.ping(), this.config.INFRA_TIMEOUT_MS);
  }
  async stop() {
    try {
      if (this.instance) await bounded(this.instance.close(), this.config.INFRA_TIMEOUT_MS);
    } finally {
      if (this.connection.isOpen) this.connection.destroy();
    }
  }
}
