import { describe, expect, it } from 'vitest';
import { credentialsSchema, safeReturnTo } from './auth-validation';

describe('authentication input validation', () => {
  it('trims email without transforming passwords, and checks confirmation', () => {
    const schema = credentialsSchema('register');
    const data = schema.parse({
      email: ' reader@example.test ',
      password: ' password ',
      confirmation: ' password ',
    });
    expect(data.email).toBe('reader@example.test');
    expect(data.password).toBe(' password ');
    expect(schema.safeParse({ ...data, confirmation: 'password' }).success).toBe(false);
    expect(
      schema.safeParse({ ...data, password: 'a'.repeat(129), confirmation: 'a'.repeat(129) })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...data, password: 'a'.repeat(128), confirmation: 'a'.repeat(128) })
        .success,
    ).toBe(true);
    expect(schema.safeParse({ ...data, password: 'short', confirmation: 'short' }).success).toBe(
      false,
    );
  });
  it('does not apply new-password rules to an existing sign-in password', () => {
    expect(
      credentialsSchema('login').safeParse({
        email: 'reader@example.test',
        password: 'short',
        confirmation: '',
      }).success,
    ).toBe(true);
  });
  it.each([
    null,
    'https://example.test',
    '//example.test',
    '/\\example.test',
    '/%5cexample.test',
    '/login',
    '/\n/files',
    '/account?token=secret#fragment',
  ])('restricts return targets and discards sensitive parameters: %s', (value) => {
    expect(safeReturnTo(value)).toBe(value === '/account?token=secret#fragment' ? '/account' : '/');
  });
  it('preserves only supported internal destinations and a valid conversion ID', () => {
    expect(safeReturnTo('/?conversion=job_1&token=discard#fragment')).toBe('/?conversion=job_1');
    expect(safeReturnTo('/?conversion=https://example.test')).toBe('/');
    expect(safeReturnTo('/files')).toBe('/files');
  });
});
