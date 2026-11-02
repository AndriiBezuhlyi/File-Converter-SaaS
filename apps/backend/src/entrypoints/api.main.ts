import 'reflect-metadata';
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
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureAuthApi } from '../modules/auth/configure-auth-api.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.withAuthentication(), {
    abortOnError: false,
  });
  const config = app.get(ConfigService<RuntimeEnvironment, true>);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  configureAuthApi(app);
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
