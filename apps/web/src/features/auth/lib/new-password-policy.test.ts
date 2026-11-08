import { expect, it } from 'vitest';
import { credentialsSchema } from './auth-validation';
import { changePasswordSchema } from '../../account/lib/account-validation';
import { newPasswordIssue } from './new-password-policy';

it.each([
  ['x'.repeat(9), false],
  ['x'.repeat(10), true],
  ['x'.repeat(128), true],
  ['x'.repeat(129), false],
  ['😀'.repeat(9), false],
  ['😀'.repeat(10), true],
  ['😀'.repeat(128), true],
  ['😀'.repeat(129), false],
  ['e\u0301'.repeat(5), true],
  ['☀️'.repeat(5), true],
  [' a river at dawn ', true],
  ['Password123!', false],
  ['1234567890', false],
  ['Password1!', false],
  ['FLUX CONVERTER2026!', false],
  ['clarityconverter123', false],
  ['long quiet river at dawn', true],
])('applies equivalent registration/reset/change decisions for case %#', (password, valid) => {
  expect(newPasswordIssue(password) === null).toBe(valid);
  for (const mode of ['register', 'reset'] as const) {
    const result = credentialsSchema(mode).safeParse({
      email: 'owned@example.test',
      password,
      confirmation: password,
    });
    expect(result.success).toBe(valid);
    if (result.success) expect(result.data.password).toBe(password);
  }
  expect(
    changePasswordSchema.safeParse({
      currentPassword: 'password12',
      newPassword: password,
      confirmation: password,
    }).success,
  ).toBe(valid);
  expect(
    credentialsSchema('login').safeParse({
      email: 'owned@example.test',
      password,
      confirmation: '',
    }).success,
  ).toBe(true);
});
