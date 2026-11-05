import { describe, expect, it } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { createAuthGateway } from './auth-http-gateway';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';
import { AuthRequestError } from './auth-gateway';

describe('live authentication gateway required by account management', () => {
  it('uses the current CSRF token for each identity mutation and maps the generated session', async () => {
    let token = 0;
    const headers: unknown[] = [];
    const adapter: AxiosAdapter = (config) => {
      let data: unknown;
      let status = 200;
      if (config.url === 'auth/csrf') data = { csrfToken: `synthetic-${++token}` };
      else if (config.url === 'auth/logout') {
        status = 204;
        headers.push(config.headers.get('X-CSRF-Token'));
      } else {
        if (config.method === 'post') headers.push(config.headers.get('X-CSRF-Token'));
        data = {
          kind: 'authenticated',
          user: { id: 'synthetic-account', email: 'owned@example.test', displayName: '' },
          expiresAt: '2026-11-05T12:00:00Z',
        };
      }
      return Promise.resolve({ data, status, statusText: '', headers: {}, config });
    };
    const gateway = createAuthGateway(createSessionClient(createHttpClient({ adapter })));
    await expect(
      gateway.signIn({ email: 'owned@example.test', password: 'synthetic-password' }),
    ).resolves.toBe('signed-in');
    await expect(gateway.readSession(new AbortController().signal)).resolves.toEqual({
      kind: 'authenticated',
      email: 'owned@example.test',
    });
    await gateway.signOut();
    expect(headers).toEqual(['synthetic-1', 'synthetic-2']);
  });
  it.each([
    [403, 'EMAIL_NOT_VERIFIED', 'verification-required'],
    [401, 'INVALID_CREDENTIALS', 'invalid-credentials'],
    [429, 'RATE_LIMITED', 'rate-limited'],
  ] as const)('handles sanitized login rejection %s %s', async (status, code, expected) => {
    const adapter: AxiosAdapter = (config) =>
      Promise.resolve({
        data:
          config.url === 'auth/csrf'
            ? { csrfToken: 'synthetic' }
            : { error: { code, message: 'Do not retain server text.' } },
        status: config.url === 'auth/csrf' ? 200 : status,
        statusText: '',
        headers: {},
        config,
      });
    const gateway = createAuthGateway(createSessionClient(createHttpClient({ adapter })));
    const result = gateway.signIn({ email: 'owned@example.test', password: 'synthetic-password' });
    if (expected === 'verification-required') await expect(result).resolves.toBe(expected);
    else await expect(result).rejects.toEqual(new AuthRequestError(expected));
  });
});
