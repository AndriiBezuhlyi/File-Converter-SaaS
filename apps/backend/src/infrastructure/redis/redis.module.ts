import { Module } from '@nestjs/common';
import { InfrastructureConfigModule } from '../config/infrastructure-config.js';
import { RedisService } from './redis.service.js';

@Module({
  imports: [InfrastructureConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
