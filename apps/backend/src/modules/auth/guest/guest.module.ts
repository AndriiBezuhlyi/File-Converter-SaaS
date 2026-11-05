import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { DatabaseModule } from '../../../infrastructure/database/database.module.js';
import { AuthSecurityModule } from '../auth-security.module.js';
import { AuthSessionMiddleware } from '../auth-boundary.js';
import { GuestConfigModule } from './guest-config.js';
import { GuestCredentialsService } from './guest-credentials.service.js';
import { GuestBoundaryGuard } from './guest-boundary.guard.js';
import { GuestController } from './guest.controller.js';
import { GuestTrialModule } from './guest-trial.module.js';

@Module({
  imports: [DatabaseModule, AuthSecurityModule, GuestConfigModule, GuestTrialModule],
  controllers: [GuestController],
  providers: [GuestCredentialsService, GuestBoundaryGuard],
  exports: [GuestCredentialsService, GuestTrialModule],
})
export class GuestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthSessionMiddleware).forRoutes(GuestController);
  }
}
