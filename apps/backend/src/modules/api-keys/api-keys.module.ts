import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AuthSecurityModule } from '../auth/auth-security.module.js';
import { AuthSessionMiddleware } from '../auth/auth-boundary.js';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';
import { ApiKeyGuard } from './api-key.guard.js';

@Module({
  imports: [AuthSecurityModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard],
  exports: [ApiKeysService, ApiKeyGuard],
})
export class ApiKeysModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthSessionMiddleware).forRoutes(ApiKeysController);
  }
}
