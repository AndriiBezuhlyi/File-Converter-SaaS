import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InfrastructureService } from '../infrastructure.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly infrastructure: InfrastructureService) {}
  @Get('live')
  live() {
    return { status: 'ok' };
  }
  @Get('ready')
  async ready() {
    const result = await this.infrastructure.readiness();
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
