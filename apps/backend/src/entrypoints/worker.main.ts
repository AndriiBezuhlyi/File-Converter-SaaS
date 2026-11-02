import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from '../worker.module.js';
import {
  INFRA_CONFIG,
  type InfrastructureEnvironment,
} from '../infrastructure/config/infrastructure-config.js';
import { installShutdown } from '../infrastructure/shutdown.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule.withNotifications(), {
    abortOnError: false,
  });
  installShutdown(app, app.get<InfrastructureEnvironment>(INFRA_CONFIG).SHUTDOWN_TIMEOUT_MS);
  Logger.log(
    'Worker infrastructure and notifications ready. No conversion processors are registered.',
    'WorkerBootstrap',
  );
}

void bootstrap().catch(() => {
  console.error('Worker bootstrap failed.');
  process.exit(1);
});
