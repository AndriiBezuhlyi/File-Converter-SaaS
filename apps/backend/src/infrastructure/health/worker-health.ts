import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { INFRA_CONFIG, type InfrastructureEnvironment } from '../config/infrastructure-config.js';
import { InfrastructureService } from '../infrastructure.service.js';
import type { InfrastructureDependency } from '../dependency.js';

export const WORKER_FEATURE_READINESS = Symbol('WORKER_FEATURE_READINESS');

@Injectable()
export class WorkerHealth implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;
  private pending: Promise<void> | undefined;
  constructor(
    @Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment,
    private readonly infrastructure: InfrastructureService,
    @Optional()
    @Inject(WORKER_FEATURE_READINESS)
    private readonly feature?: Pick<InfrastructureDependency, 'check'>,
  ) {}
  async onApplicationBootstrap() {
    await mkdir(this.config.WORKER_TEMP_DIR, { recursive: true, mode: 0o700 });
    await this.tick();
  }
  private async tick() {
    if (this.stopping) return;
    this.pending = this.publish();
    try {
      await this.pending;
    } finally {
      if (!this.stopping)
        this.timer = setTimeout(() => {
          void this.tick().catch(() => {});
        }, this.config.HEALTH_CHECK_INTERVAL_MS);
    }
  }
  private async publish() {
    const readiness = await this.infrastructure.readiness();
    let featureReady = true;
    try {
      await this.feature?.check();
    } catch {
      featureReady = false;
    }
    const path = join(this.config.WORKER_TEMP_DIR, 'health.json');
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        pid: process.pid,
        checkedAt: Date.now(),
        ready: !this.stopping && readiness.status === 'ok' && featureReady,
      }),
      { mode: 0o600 },
    );
    await rename(temporary, path);
  }
  async beforeApplicationShutdown() {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.pending?.catch(() => {});
    await this.publish().catch(() => {});
  }
}
