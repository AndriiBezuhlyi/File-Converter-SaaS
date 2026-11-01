import { Module } from '@nestjs/common';
import { InfrastructureConfigModule } from '../config/infrastructure-config.js';
import { EmailService } from './email.service.js';

@Module({
  imports: [InfrastructureConfigModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
