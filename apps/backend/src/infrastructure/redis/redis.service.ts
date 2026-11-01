import { Inject, Injectable, Logger } from '@nestjs/common';
import { createClient } from 'redis';
import { INFRA_CONFIG, type InfrastructureEnvironment } from '../config/infrastructure-config.js';
import { bounded, type InfrastructureDependency } from '../dependency.js';

@Injectable()
export class RedisService implements InfrastructureDependency {
  readonly client;
  readonly sessionPrefix: string;
  readonly rateLimitPrefix: string;

  constructor(@Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment) {
    this.sessionPrefix = `${config.REDIS_NAMESPACE}:session:`;
    this.rateLimitPrefix = `${config.REDIS_NAMESPACE}:rate-limit:`;
    this.client = createClient({
      url: config.REDIS_URL,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1_000,
      socket: {
        connectTimeout: config.INFRA_TIMEOUT_MS,
        reconnectStrategy: (attempt) => Math.min(250 * (attempt + 1), 2_000),
      },
    });
    this.client.on('error', () => Logger.warn('Redis connection unavailable.', 'RedisService'));
  }
  async start() {
    await this.client.connect();
    await this.check();
  }
  async check() {
    if (!this.client.isReady) throw new Error('Redis is not ready.');
    await bounded(this.client.ping(), this.config.INFRA_TIMEOUT_MS);
  }
  async stop() {
    if (!this.client.isOpen) return;
    try {
      await bounded(this.client.close(), this.config.INFRA_TIMEOUT_MS);
    } finally {
      if (this.client.isOpen) this.client.destroy();
    }
  }
}
