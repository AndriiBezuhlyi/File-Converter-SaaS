import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AuthConfigModule } from './auth-config.js';
import { AccountRepository } from './account.repository.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { AuthSessionMiddleware, AuthBoundaryGuard } from './auth-boundary.js';

const providers = [
  AccountRepository,
  PasswordService,
  SessionService,
  RateLimitService,
  AuthSessionMiddleware,
  AuthBoundaryGuard,
];
@Module({
  imports: [DatabaseModule, RedisModule, AuthConfigModule, NotificationsModule],
  providers,
  exports: [...providers, NotificationsModule],
})
export class AuthSecurityModule {}
