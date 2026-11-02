import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  EmailDto,
  RegisterDto,
  LoginDto,
  PasswordChangeDto,
  PasswordResetDto,
} from './auth.dto.js';
import { validateAuthConfig } from './auth-config.js';
import { validateNotificationConfig } from '../notifications/notification-config.js';
import { NotificationCipher } from '../notifications/notification-cipher.js';
import { PasswordService } from './password.service.js';

const secret = randomBytes(32).toString('hex');
const config = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://127.0.0.1:5173',
  NOTIFICATION_ENCRYPTION_KEY: secret,
};

it('enforces the agreed 10–128 character new-password policy without changing login or trimming passwords', async () => {
  const types: (new () => object)[] = [RegisterDto, PasswordChangeDto, PasswordResetDto];
  for (const Type of types) {
    const field = Type === RegisterDto ? 'password' : 'newPassword';
    const base = {
      email: 'owned@example.test',
      currentPassword: 'existing',
      token: `${randomUUID()}.${randomBytes(32).toString('base64url')}`,
    };
    for (const length of [9, 10, 128, 129]) {
      const errors = await validate(
        plainToInstance(Type, { ...base, [field]: 'x'.repeat(length) }),
      );
      expect(errors.some((error) => error.property === field)).toBe(length < 10 || length > 128);
    }
  }
  const login = plainToInstance(LoginDto, { email: '  OWNED@EXAMPLE.TEST ', password: ' x ' });
  expect(await validate(login)).toHaveLength(0);
  expect(login.email).toBe('owned@example.test');
  expect(login.password).toBe(' x ');
});

it('rejects unsafe origins, invalid keys and blanket proxy trust without revealing rejected values', () => {
  expect(validateNotificationConfig(config).APP_ORIGIN).toBe(config.APP_ORIGIN);
  for (const origin of [
    'http://example.test',
    'https://example.test/path',
    'https://user:pass@example.test',
    'https://example.test/',
  ])
    expect(() => validateNotificationConfig({ ...config, APP_ORIGIN: origin })).toThrow(
      'APP_ORIGIN',
    );
  expect(() => validateNotificationConfig({ ...config, NODE_ENV: 'production' })).toThrow(
    'APP_ORIGIN',
  );
  expect(() =>
    validateNotificationConfig({ ...config, NOTIFICATION_ENCRYPTION_KEY: 'sensitive-invalid-key' }),
  ).toThrow('NOTIFICATION_ENCRYPTION_KEY');
  expect(() =>
    validateAuthConfig({ SESSION_SECRET: secret, AUTH_TRUSTED_PROXIES: 'true' }),
  ).toThrow('AUTH_TRUSTED_PROXIES');
  expect(() =>
    validateAuthConfig({ SESSION_SECRET: secret, AUTH_TRUSTED_PROXIES: '0.0.0.0/0' }),
  ).toThrow('AUTH_TRUSTED_PROXIES');
  expect(
    validateAuthConfig({ SESSION_SECRET: secret, AUTH_TRUSTED_PROXIES: '127.0.0.1/32,::1/128' })
      .AUTH_TRUSTED_PROXIES,
  ).toHaveLength(2);
});

it('authenticates outbox ciphertext and binds it to its own task, without plaintext delivery secrets', () => {
  const cipher = new NotificationCipher(validateNotificationConfig(config));
  const id = randomUUID();
  const data = {
    to: 'owned@example.test',
    token: 'synthetic-link-secret',
    tokenId: randomUUID(),
    purpose: 'password_reset' as const,
  };
  const encrypted = cipher.encrypt(id, data);
  expect(JSON.stringify(encrypted)).not.toContain(data.token);
  expect(JSON.stringify(encrypted)).not.toContain(data.to);
  expect(cipher.decrypt(id, encrypted)).toEqual(data);
  expect(() => cipher.decrypt(randomUUID(), encrypted)).toThrow();
  expect(() =>
    cipher.decrypt(id, { ...encrypted, tag: randomBytes(16).toString('base64') }),
  ).toThrow();
});

it('uses the same practical email syntax at the HTTP and encrypted delivery boundaries', async () => {
  const unsupported = plainToInstance(EmailDto, { email: '"owned user"@example.test' });
  expect(await validate(unsupported)).not.toHaveLength(0);
  const supported = plainToInstance(EmailDto, { email: 'Owned+tag@Example.test' });
  expect(await validate(supported)).toHaveLength(0);
  expect(supported.email).toBe('owned+tag@example.test');
});

it('hashes with Argon2id and rejects incorrect and nonexistent-account credentials', async () => {
  const passwords = new PasswordService();
  const hash = await passwords.hash('Owned test password 10');
  expect(hash).toMatch(/^\$argon2id\$/);
  expect(await passwords.matches('Owned test password 10', hash)).toBe(true);
  expect(await passwords.matches('wrong', hash)).toBe(false);
  expect(await passwords.matches('wrong')).toBe(false);
});
