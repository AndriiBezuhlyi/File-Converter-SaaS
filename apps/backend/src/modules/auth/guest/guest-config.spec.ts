import { randomBytes } from 'node:crypto';
import { validateGuestConfig } from './guest-config.js';
import { GuestCredentialsService } from './guest-credentials.service.js';
import type { DatabaseService } from '../../../infrastructure/database/database.service.js';
import type { Request } from 'express';

it('bounds the configured lifetime and keeps the agreed thirty-day default', () => {
  expect(validateGuestConfig({}).GUEST_CREDENTIAL_TTL_SECONDS).toBe(2_592_000);
  expect(
    validateGuestConfig({ GUEST_CREDENTIAL_TTL_SECONDS: 10_800 }).GUEST_CREDENTIAL_TTL_SECONDS,
  ).toBe(10_800);
  for (const value of [0, 7_200, 10_799, 31_536_001, 'invalid'])
    expect(() => validateGuestConfig({ GUEST_CREDENTIAL_TTL_SECONDS: value })).toThrow(
      'GUEST_CREDENTIAL_TTL_SECONDS',
    );
});
it('parses only its own opaque cookie and rejects empty, malformed or duplicate credentials', () => {
  const service = new GuestCredentialsService({} as DatabaseService, validateGuestConfig({}), {
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://127.0.0.1:5173',
    NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  });
  const request = (cookie?: string) => ({ headers: { cookie } }) as Request;
  const token = randomBytes(32).toString('base64url');
  expect(service.read(request('unrelated=value'))).toBeUndefined();
  expect(service.read(request(`converter.dev.guest=${token}; unrelated=value`))).toBe(token);
  for (const cookie of [
    'converter.dev.guest=',
    'converter.dev.guest=bad',
    `converter.dev.guest=${token}; converter.dev.guest=${token}`,
  ])
    expect(() => service.read(request(cookie))).toThrow();
});
