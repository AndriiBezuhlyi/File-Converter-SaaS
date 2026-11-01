import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { ApiModule } from '../api.module.js';
import type { RuntimeEnvironment } from '../infrastructure/config/environment.js';
import {
  INFRA_CONFIG,
  type InfrastructureEnvironment,
} from '../infrastructure/config/infrastructure-config.js';
import { installShutdown } from '../infrastructure/shutdown.js';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule.withInfrastructure(), { abortOnError: false });
  const config = app.get(ConfigService<RuntimeEnvironment, true>);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  installShutdown(app, app.get<InfrastructureEnvironment>(INFRA_CONFIG).SHUTDOWN_TIMEOUT_MS);
  try {
    await app.listen(
      config.get('API_PORT', { infer: true }),
      config.get('API_HOST', { infer: true }),
    );
  } catch {
    await app.close();
    throw new Error('API startup failed.');
  }
}

void bootstrap().catch(() => {
  console.error('API bootstrap failed.');
  process.exit(1);
});
