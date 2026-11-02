import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AuthSessionMiddleware } from './auth-boundary.js';
import { AuthSecurityModule } from './auth-security.module.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';

@Module({
  imports: [AuthSecurityModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthSessionMiddleware).forRoutes(AuthController);
  }
}
