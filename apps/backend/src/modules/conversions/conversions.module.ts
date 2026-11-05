import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type OnModuleDestroy,
} from '@nestjs/common';
import { rmdir } from 'node:fs/promises';
import { UPLOAD_STAGING_DIRECTORY } from './upload-staging.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { QueueModule } from '../../infrastructure/queue/queue.module.js';
import { AuthSecurityModule } from '../auth/auth-security.module.js';
import { GuestModule } from '../auth/guest/guest.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ConversionBoundaryGuard, ConversionSessionMiddleware } from './conversion-boundary.js';
import {
  ConversionAdmissionGuard,
  ConversionCapabilitiesController,
  ConversionsController,
} from './conversions.controller.js';
import { ConversionsService } from './conversions.service.js';
import { UploadBudgetInterceptor } from './upload-budget.interceptor.js';

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    QueueModule,
    AuthSecurityModule,
    GuestModule,
    ApiKeysModule,
  ],
  controllers: [ConversionsController, ConversionCapabilitiesController],
  providers: [
    UploadBudgetInterceptor,
    ConversionsService,
    ConversionBoundaryGuard,
    ConversionSessionMiddleware,
    ConversionAdmissionGuard,
  ],
})
export class ConversionsModule implements NestModule, OnModuleDestroy {
  async onModuleDestroy() {
    // Remove only an empty directory; crash leftovers are reconciled by item 16.
    await rmdir(UPLOAD_STAGING_DIRECTORY).catch(() => undefined);
  }
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ConversionSessionMiddleware).forRoutes(ConversionsController);
  }
}
