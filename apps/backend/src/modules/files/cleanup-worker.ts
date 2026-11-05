import {
  Injectable,
  Inject,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { CleanupService } from './cleanup.service.js';
import {
  INFRA_CONFIG,
  type InfrastructureEnvironment,
} from '../../infrastructure/config/infrastructure-config.js';
import { bounded } from '../../infrastructure/dependency.js';

@Injectable()
export class CleanupWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private stopping = false;
  private healthy = false;
  constructor(
    private readonly cleanup: CleanupService,
    @Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment,
  ) {}
  async onApplicationBootstrap() {
    await this.tick();
  }
  private async tick() {
    if (this.stopping) return;
    this.pending = this.cleanup.sweep();
    try {
      await this.pending;
      this.healthy = true;
    } catch {
      this.healthy = false;
      Logger.warn('File cleanup unavailable.', 'CleanupWorker');
    } finally {
      if (!this.stopping)
        this.timer = setTimeout(() => {
          void this.tick();
        }, 30_000);
    }
  }
  check() {
    if (!this.healthy || this.stopping) throw new Error('File cleanup unavailable.');
  }
  async beforeApplicationShutdown() {
    this.stopping = true;
    this.cleanup.stop();
    clearTimeout(this.timer);
    await bounded(this.pending ?? Promise.resolve(), this.config.SHUTDOWN_TIMEOUT_MS - 1_000).catch(
      () => undefined,
    );
  }
}
