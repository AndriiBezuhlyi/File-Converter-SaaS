import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { RequestHandler } from 'express';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AUTH_CONFIG, validateAuthConfig } from '../src/modules/auth/auth-config.js';
import {
  NOTIFICATION_CONFIG,
  validateNotificationConfig,
} from '../src/modules/notifications/notification-config.js';
import { configureAuthApi } from '../src/modules/auth/configure-auth-api.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import { RegistrationStatusService } from '../src/modules/auth/registration-status.service.js';
import { RateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { unavailable } from '../src/modules/auth/auth-error.js';

describe('registration status HTTP contract with controlled persistence/session adapters', () => {
  let app: NestExpressApplication;
  const origin = 'http://127.0.0.1:5173';
  const receipt = 'r'.repeat(43);
  const account = { id: 'new-user', email: 'owned@example.test', sessionVersion: 0 };
  const register = jest.fn<() => Promise<typeof account | null>>();
  const issue = jest.fn<() => Promise<{ receipt: string; expiresAt: string }>>();
  const read = jest.fn<() => Promise<{ status: string }>>();
  const rates = jest.fn<(...args: unknown[]) => Promise<void>>();
  const middleware: RequestHandler = (req, _res, next) => {
    Object.defineProperty(req, 'sessionID', { value: 'controlled-session', configurable: true });
    next();
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(AUTH_CONFIG)
      .useValue(validateAuthConfig({ SESSION_SECRET: randomBytes(32).toString('hex') }))
      .overrideProvider(NOTIFICATION_CONFIG)
      .useValue(
        validateNotificationConfig({
          NODE_ENV: 'test',
          APP_ORIGIN: origin,
          NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        }),
      )
      .overrideProvider(SessionService)
      .useValue({
        middleware,
        validCsrf: (req: { headers: Record<string, string> }) =>
          req.headers['x-csrf-token'] === 'controlled',
        user: () => Promise.resolve(undefined),
      })
      .overrideProvider(AuthService)
      .useValue({ register })
      .overrideProvider(RegistrationStatusService)
      .useValue({ issue, read })
      .overrideProvider(RateLimitService)
      .useValue({ check: rates })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    configureAuthApi(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    register.mockResolvedValue(account);
    issue.mockResolvedValue({ receipt, expiresAt: '2026-11-08T16:30:00.000Z' });
    read.mockResolvedValue({ status: 'pending' });
    rates.mockResolvedValue(undefined);
  });
  const post = (path: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/' + path)
      .set('Origin', origin)
      .set('X-CSRF-Token', 'controlled');

  it('preserves legacy acknowledgement and gives identical opt-in responses for new and duplicate accounts', async () => {
    const credentials = { email: 'owned@example.test', password: 'synthetic password' };
    await post('register').send(credentials).expect(202).expect({ status: 'accepted' });
    expect(issue).not.toHaveBeenCalled();
    for (const result of [account, null]) {
      register.mockResolvedValueOnce(result);
      await post('register')
        .send({ ...credentials, trackStatus: true })
        .expect(202)
        .expect('Cache-Control', 'no-store')
        .expect({
          status: 'accepted',
          registration: { receipt, expiresAt: '2026-11-08T16:30:00.000Z' },
        });
      expect(issue).toHaveBeenLastCalledWith('controlled-session', result);
    }
    await post('register')
      .send({ ...credentials, trackStatus: false })
      .expect(400);
  });
  it('requires CSRF, exact Origin and first-party context; rejects email/user/token lookup', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/registration/status')
      .send({ receipt })
      .expect(403);
    await post('registration/status')
      .set('Origin', 'https://other.example.test')
      .send({ receipt })
      .expect(403);
    await post('registration/status')
      .set('X-API-Key', 'invalid-synthetic')
      .send({ receipt })
      .expect(401);
    for (const body of [
      { receipt: 'invalid' },
      { receipt, email: 'foreign@example.test' },
      { receipt, userId: 'foreign' },
      { receipt, token: receipt },
    ])
      await post('registration/status').send(body).expect(400);
    expect(read).not.toHaveBeenCalled();
  });
  it('returns only status, applies IP/session limits and sanitizes failures', async () => {
    for (const status of ['pending', 'verified', 'expired']) {
      read.mockResolvedValueOnce({ status });
      await post('registration/status')
        .send({ receipt })
        .expect(200)
        .expect('Cache-Control', 'no-store')
        .expect({ status });
      expect(read).toHaveBeenLastCalledWith('controlled-session', receipt);
    }
    expect(
      rates.mock.calls.some(
        ([scope, , limit, window]) =>
          scope === 'registration-status:ip' && limit === 60 && window === 60_000,
      ),
    ).toBe(true);
    expect(
      rates.mock.calls.some(
        ([scope, id, limit]) =>
          scope === 'registration-status:session' && id === 'controlled-session' && limit === 30,
      ),
    ).toBe(true);
    read.mockRejectedValueOnce(unavailable());
    await post('registration/status')
      .send({ receipt })
      .expect(503)
      .expect({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.' },
      });
  });
});
