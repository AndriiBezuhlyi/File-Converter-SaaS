import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { QueueModule } from '../../infrastructure/queue/queue.module.js';
import { GuestTrialModule } from '../auth/guest/guest-trial.module.js';
import { ConversionEngine } from './conversion-engine.js';
import { ConversionProcessingService } from './conversion-processing.service.js';
import { ConversionWorker } from './conversion-worker.js';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module.js';
import { CleanupService } from '../files/cleanup.service.js';
import { CleanupWorker } from '../files/cleanup-worker.js';

@Module({
  imports: [InfrastructureModule, DatabaseModule, StorageModule, QueueModule, GuestTrialModule],
  providers: [
    ConversionEngine,
    ConversionProcessingService,
    ConversionWorker,
    CleanupService,
    CleanupWorker,
  ],
  exports: [ConversionWorker, CleanupWorker],
})
export class ConversionWorkerModule {}
