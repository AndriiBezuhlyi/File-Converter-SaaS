import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnvironment } from './environment.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
      // Preserve integration variables for the separately validated runtime infrastructure.
      validate: (input: Record<string, unknown>) => ({ ...input, ...validateEnvironment(input) }),
    }),
  ],
})
export class RuntimeConfigModule {}
