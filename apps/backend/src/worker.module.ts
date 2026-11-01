import { Module, type DynamicModule } from '@nestjs/common';
import { RuntimeConfigModule } from './infrastructure/config/runtime-config.module.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { WorkerHealth } from './infrastructure/health/worker-health.js';

@Module({ imports: [RuntimeConfigModule] })
export class WorkerModule {
  static withInfrastructure(): DynamicModule {
    return { module: WorkerModule, imports: [InfrastructureModule], providers: [WorkerHealth] };
  }
}
