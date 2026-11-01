import { Module } from '@nestjs/common';
import { InfrastructureConfigModule } from '../config/infrastructure-config.js';
import { QueueService } from './queue.service.js';

// Producer connection only. Processors and blocking consumer connections belong to item 15.
@Module({
  imports: [InfrastructureConfigModule],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
