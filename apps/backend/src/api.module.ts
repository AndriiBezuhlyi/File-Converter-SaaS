import { Module, type DynamicModule } from '@nestjs/common';
import { RuntimeConfigModule } from './infrastructure/config/runtime-config.module.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { HealthController } from './infrastructure/health/health.controller.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { GuestModule } from './modules/auth/guest/guest.module.js';
import { ApiKeysModule } from './modules/api-keys/api-keys.module.js';

@Module({ imports: [RuntimeConfigModule] })
export class ApiModule {
  static withAuthentication(): DynamicModule {
    return {
      ...this.withInfrastructure(),
      imports: [InfrastructureModule, AuthModule, UsersModule, GuestModule, ApiKeysModule],
    };
  }
  static withInfrastructure(): DynamicModule {
    return { module: ApiModule, imports: [InfrastructureModule], controllers: [HealthController] };
  }
}
