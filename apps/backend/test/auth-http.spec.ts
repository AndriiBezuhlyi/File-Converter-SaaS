import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { RequestHandler } from 'express';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AUTH_CONFIG, validateAuthConfig } from '../src/modules/auth/auth-config.js';
import {
  NOTIFICATION_CONFIG,
  validateNotificationConfig,
} from '../src/modules/notifications/notification-config.js';
import { configureAuthApi } from '../src/modules/auth/configure-auth-api.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import { RateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthError } from '../src/modules/auth/auth-error.js';

describe('first-party auth HTTP boundary (controlled service/session adapters)', () => {
  let app: NestExpressApplication<Server>;
  const register = jest
    .fn<(email: string, password: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const login = jest
    .fn<() => Promise<never>>()
    .mockRejectedValue(
      new AuthError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before signing in.'),
    );
  const middleware: RequestHandler = (_request, _response, next) => next();
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(AUTH_CONFIG)
      .useValue(validateAuthConfig({ SESSION_SECRET: randomBytes(32).toString('hex') }))
      .overrideProvider(NOTIFICATION_CONFIG)
      .useValue(
        validateNotificationConfig({
          NODE_ENV: 'test',
          APP_ORIGIN: 'http://127.0.0.1:5173',
          NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        }),
      )
      .overrideProvider(SessionService)
      .useValue({
        middleware,
        validCsrf: (req: { headers: Record<string, string> }) =>
          req.headers['x-csrf-token'] === 'controlled-csrf',
        user: () => Promise.resolve(undefined),
      })
      .overrideProvider(RateLimitService)
      .useValue({ check: async () => {} })
      .overrideProvider(AuthService)
      .useValue({ register, login })
      .compile();
    app = module.createNestApplication<NestExpressApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    configureAuthApi(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  const post = () => request(app.getHttpServer()).post('/api/v1/auth/register');
  it('requires the exact Origin and synchronizer header even for anonymous mutations', async () => {
    await post().send({}).expect(403).expect('Cache-Control', 'no-store');
    await post().set('Origin', 'http://127.0.0.1:5173').send({}).expect(403);
    await post()
      .set('Origin', 'https://other.example.test')
      .set('X-CSRF-Token', 'controlled-csrf')
      .send({})
      .expect(403);
    expect(register).not.toHaveBeenCalled();
  });
  it('rejects explicit API keys instead of falling back to cookie/anonymous context', async () => {
    await post().set('X-API-Key', 'invalid-synthetic').send({}).expect(401);
    expect(register).not.toHaveBeenCalled();
  });
  it('rejects a 9-character password and extra fields, accepts 10 and normalizes email', async () => {
    for (const body of [
      { email: 'owned@example.test', password: '123456789' },
      { email: 'owned@example.test', password: 'r7V!m2Q#z9', role: 'admin' },
    ])
      await post()
        .set('Origin', 'http://127.0.0.1:5173')
        .set('X-CSRF-Token', 'controlled-csrf')
        .send(body)
        .expect(400)
        .expect({ error: { code: 'VALIDATION_FAILED', message: 'Invalid request fields.' } });
    await post()
      .set('Origin', 'http://127.0.0.1:5173')
      .set('X-CSRF-Token', 'controlled-csrf')
      .send({ email: '  OWNED@EXAMPLE.TEST ', password: 'r7V!m2Q#z9' })
      .expect(202)
      .expect({ status: 'accepted' });
    expect(register).toHaveBeenLastCalledWith('owned@example.test', 'r7V!m2Q#z9');
  });
  it('keeps auth rejection codes and no-store headers without exposing inputs', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('X-CSRF-Token', 'controlled-csrf')
      .send({ email: 'owned@example.test', password: 'existing' })
      .expect(403)
      .expect('Cache-Control', 'no-store')
      .expect({
        error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before signing in.' },
      });
  });
  it('rejects fields on bodyless logout rather than silently ignoring them', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('X-CSRF-Token', 'controlled-csrf')
      .send({ unexpected: true })
      .expect(400);
  });
});
