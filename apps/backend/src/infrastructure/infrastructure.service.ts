import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { INFRA_CONFIG, type InfrastructureEnvironment } from './config/infrastructure-config.js';
import { DatabaseService } from './database/database.service.js';
import { RedisService } from './redis/redis.service.js';
import { QueueService } from './queue/queue.service.js';
import { StorageService } from './storage/storage.service.js';
import { EmailService } from './email/email.service.js';
import { bounded, type InfrastructureDependency } from './dependency.js';

export interface Readiness {
  status: 'ok' | 'unavailable';
  dependencies: Record<string, 'up' | 'down'>;
}

@Injectable()
export class InfrastructureService
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly dependencies: Record<string, InfrastructureDependency>;
  private started = false;
  private stopping = false;
  private stopped = false;
  private cached: { at: number; result: Readiness } | undefined;
  private checking: Promise<Readiness> | undefined;

  constructor(
    @Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment,
    database: DatabaseService,
    redis: RedisService,
    queue: QueueService,
    storage: StorageService,
    email: EmailService,
  ) {
    this.dependencies = { database, redis, queue, storage, email };
  }

  async onApplicationBootstrap() {
    const results = await Promise.allSettled(
      Object.values(this.dependencies).map((dependency) =>
        bounded(dependency.start(), this.config.INFRA_TIMEOUT_MS),
      ),
    );
    if (results.some((result) => result.status === 'rejected')) {
      await this.onApplicationShutdown();
      throw new Error(
        'Infrastructure startup failed. Check service availability and configuration.',
      );
    }
    this.started = true;
  }

  async readiness(): Promise<Readiness> {
    if (!this.started || this.stopping) return { status: 'unavailable', dependencies: {} };
    if (this.cached && Date.now() - this.cached.at < this.config.HEALTH_CHECK_INTERVAL_MS)
      return this.cached.result;
    this.checking ??= this.inspect().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  private async inspect(): Promise<Readiness> {
    const entries = await Promise.all(
      Object.entries(this.dependencies).map(async ([name, dependency]) => {
        try {
          await bounded(dependency.check(), this.config.INFRA_TIMEOUT_MS);
          return [name, 'up'] as const;
        } catch {
          return [name, 'down'] as const;
        }
      }),
    );
    const result: Readiness = {
      status: !this.stopping && entries.every(([, state]) => state === 'up') ? 'ok' : 'unavailable',
      dependencies: Object.fromEntries(entries),
    };
    this.cached = { at: Date.now(), result };
    return result;
  }
  beforeApplicationShutdown() {
    this.stopping = true;
    this.cached = undefined;
  }
  async onApplicationShutdown() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopping = true;
    const results = await Promise.allSettled(
      Object.values(this.dependencies).map(async (dependency) =>
        bounded(
          Promise.resolve().then(() => dependency.stop()),
          this.config.INFRA_TIMEOUT_MS,
        ),
      ),
    );
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Infrastructure shutdown failed.');
  }
}
