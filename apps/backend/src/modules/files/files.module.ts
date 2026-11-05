import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { AuthSecurityModule } from '../auth/auth-security.module.js';
import { GuestModule } from '../auth/guest/guest.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import {
  ConversionBoundaryGuard,
  ConversionSessionMiddleware,
} from '../conversions/conversion-boundary.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Module({
  imports: [DatabaseModule, StorageModule, AuthSecurityModule, GuestModule, ApiKeysModule],
  controllers: [FilesController],
  providers: [FilesService, ConversionBoundaryGuard, ConversionSessionMiddleware],
})
export class FilesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ConversionSessionMiddleware).forRoutes(FilesController);
  }
}
