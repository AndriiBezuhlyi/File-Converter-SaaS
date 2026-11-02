import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AuthSecurityModule } from '../auth/auth-security.module.js';
import { AuthSessionMiddleware } from '../auth/auth-boundary.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthSecurityModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthSessionMiddleware).forRoutes(UsersController);
  }
}
