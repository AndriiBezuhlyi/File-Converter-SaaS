import { Module, type DynamicModule } from '@nestjs/common';
import { RuntimeConfigModule } from './infrastructure/config/runtime-config.module.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { HealthController } from './infrastructure/health/health.controller.js';

@Module({ imports: [RuntimeConfigModule] })
export class ApiModule {
  static withInfrastructure(): DynamicModule {
    return { module: ApiModule, imports: [InfrastructureModule], controllers: [HealthController] };
  }
}
