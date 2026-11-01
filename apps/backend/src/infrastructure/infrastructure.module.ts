import { Module } from '@nestjs/common';
import { InfrastructureConfigModule } from './config/infrastructure-config.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';
import { QueueModule } from './queue/queue.module.js';
import { StorageModule } from './storage/storage.module.js';
import { EmailModule } from './email/email.module.js';
import { InfrastructureService } from './infrastructure.service.js';

@Module({
  imports: [
    InfrastructureConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    EmailModule,
  ],
  providers: [InfrastructureService],
  exports: [
    InfrastructureService,
    InfrastructureConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    EmailModule,
  ],
})
export class InfrastructureModule {}
