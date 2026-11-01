import { Module } from '@nestjs/common';
import { InfrastructureConfigModule } from '../config/infrastructure-config.js';
import { StorageService } from './storage.service.js';

@Module({
  imports: [InfrastructureConfigModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
