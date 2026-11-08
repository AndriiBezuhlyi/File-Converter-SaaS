import 'reflect-metadata';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthBoundaryGuard } from './auth-boundary.js';
import { AUTH_CONFIG } from './auth-config.js';
import { configureAuthApi } from './configure-auth-api.js';
import { SessionService } from './session.service.js';
import { RegistrationStatusService } from './registration-status.service.js';
import { UsersController } from '../users/users.controller.js';
import { UsersService } from '../users/users.service.js';
import { PasswordService } from './password.service.js';

let app: NestExpressApplication;
const register = jest.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null);
const reset = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const login = jest.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ id: 'owned' });
const change = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const token = `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [AuthController, UsersController],
    providers: [
      { provide: AUTH_CONFIG, useValue: { AUTH_TRUSTED_PROXIES: [] } },
      { provide: AuthService, useValue: { register, reset, login } },
      { provide: UsersService, useValue: { changePassword: change } },
      { provide: RegistrationStatusService, useValue: {} },
      {
        provide: SessionService,
        useValue: {
          login: () => ({ kind: 'authenticated' }),
          destroy: () => undefined,
        },
      },
    ],
  })
    .overrideGuard(AuthBoundaryGuard)
    .useValue({ canActivate: () => true })
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
  jest.clearAllMocks();
});

it('keeps the dependency-free server authority and frontend policy mirror identical', () => {
  expect(readFileSync('src/modules/auth/new-password-policy.ts', 'utf8')).toBe(
    readFileSync('../web/src/features/auth/lib/new-password-policy.ts', 'utf8'),
  );
});

it.each([
  ['register', 'password', 202],
  ['password-reset/confirm', 'newPassword', 204],
  ['change', 'newPassword', 204],
] as const)(
  'enforces the same policy before %s reaches a mutation',
  async (path, field, status) => {
    const route = path === 'change' ? '/api/v1/users/me/password' : `/api/v1/auth/${path}`;
    const base =
      path === 'register'
        ? { email: 'owned@example.test' }
        : path === 'change'
          ? { currentPassword: '1234567890' }
          : { token };
    for (const password of [
      '123456789',
      '😀'.repeat(129),
      'a'.repeat(10000),
      'Password123!',
      '1234567890',
      'FluxConverter2026!',
    ]) {
      const result = await request(app.getHttpServer())
        .post(route)
        .send({ ...base, [field]: password });
      expect(result.status).toBe(400);
      expect((result.body as { error: { code: string } }).error.code).toBe(
        ['Password123!', 'FluxConverter2026!', '1234567890'].includes(password)
          ? 'PASSWORD_POLICY_REJECTED'
          : 'VALIDATION_FAILED',
      );
      expect(JSON.stringify(result.body)).not.toContain(password);
    }
    expect(register).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled(); // Rejected secrets must not consume a reset token.
    expect(change).not.toHaveBeenCalled();
    for (const password of [
      '😀'.repeat(10),
      '😀'.repeat(128),
      ' a long quiet river ',
      'e\u0301'.repeat(5),
      '☀️'.repeat(5),
    ]) {
      await request(app.getHttpServer())
        .post(route)
        .send({ ...base, [field]: password })
        .expect(status);
      const mutation = path === 'register' ? register : path === 'change' ? change : reset;
      expect(mutation.mock.lastCall?.at(-1)).toBe(password);
    }
  },
);

it('keeps existing short/common credentials valid for login and current-password proof', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: 'owned@example.test', password: '1234567890' })
    .expect(200);
  expect(login).toHaveBeenCalledWith('owned@example.test', '1234567890');
  await request(app.getHttpServer())
    .post('/api/v1/users/me/password')
    .send({ currentPassword: '1234567890', newPassword: 'A quiet river at dawn' })
    .expect(204);
  expect(change.mock.lastCall?.[1]).toBe('1234567890');
  const passwords = new PasswordService();
  const hash = await passwords.hash('1234567890');
  expect(await passwords.matches('1234567890', hash)).toBe(true);
  expect(await passwords.matches('wrong', hash)).toBe(false);
});
