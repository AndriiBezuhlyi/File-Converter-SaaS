import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AUTH_CONFIG, type AuthConfig } from './auth-config.js';
import { AuthErrorFilter } from './auth-error.js';

export function configureAuthApi(app: NestExpressApplication) {
  const config = app.get<AuthConfig>(AUTH_CONFIG);
  app.set('trust proxy', config.AUTH_TRUSTED_PROXIES.length ? config.AUTH_TRUSTED_PROXIES : false);
  app.useGlobalFilters(new AuthErrorFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
}
