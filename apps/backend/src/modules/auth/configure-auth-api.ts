import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AUTH_CONFIG, type AuthConfig } from './auth-config.js';
import { AuthError, AuthErrorFilter } from './auth-error.js';

export function configureAuthApi(app: NestExpressApplication) {
  const config = app.get<AuthConfig>(AUTH_CONFIG);
  app.set('trust proxy', config.AUTH_TRUSTED_PROXIES.length ? config.AUTH_TRUSTED_PROXIES : false);
  app.useGlobalFilters(new AuthErrorFilter());
  const defaultExceptionFactory = new ValidationPipe().createExceptionFactory();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors) =>
        errors.every((error) =>
          Object.keys(error.constraints ?? {}).every(
            (constraint) => constraint === 'commonPassword',
          ),
        ) && errors.some((error) => error.constraints?.commonPassword)
          ? new AuthError(
              400,
              'PASSWORD_POLICY_REJECTED',
              'Use 10–128 Unicode code points and avoid common or predictable passwords.',
            )
          : defaultExceptionFactory(errors),
    }),
  );
}
