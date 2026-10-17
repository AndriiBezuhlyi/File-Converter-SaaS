import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from './infrastructure/config/runtime-config.module.js';

@Module({ imports: [RuntimeConfigModule] })
export class ApiModule {}
