import { Module } from '@nestjs/common';
import { InfrastructureConfigModule } from '../config/infrastructure-config.js';
import { DatabaseService } from './database.service.js';

@Module({
  imports: [InfrastructureConfigModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
