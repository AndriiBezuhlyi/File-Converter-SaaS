import { expect, it } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { createAuthGateway } from './auth-http-gateway';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';

it('opts in without changing credentials, rechecks through current CSRF, and never reads an email status lookup', async () => {
  const bodies: unknown[] = [];
  const paths: string[] = [];
  const receipt = { receipt: 'r'.repeat(43), expiresAt: '2026-11-08T17:00:00.000Z' };
  let csrf = 0;
  const adapter: AxiosAdapter = (config) => {
    paths.push(config.url!);
    if (config.method === 'post') {
      const body: unknown = JSON.parse(config.data as string);
      bodies.push(body);
      expect(config.headers.get('X-CSRF-Token')).toBe(`controlled-${csrf}`);
    }
    return Promise.resolve({
      config,
      statusText: '',
      headers: {},
      status: config.url === 'auth/register' ? 202 : 200,
      data:
        config.url === 'auth/csrf'
          ? { csrfToken: `controlled-${++csrf}` }
          : config.url === 'auth/register'
            ? { status: 'accepted', registration: receipt }
            : { status: 'pending' },
    });
  };
  const gateway = createAuthGateway(createSessionClient(createHttpClient({ adapter })));
  expect(
    await gateway.register({ email: 'owned@example.test', password: 'synthetic password' }),
  ).toEqual(receipt);
  expect(await gateway.readRegistrationStatus!(receipt.receipt, new AbortController().signal)).toBe(
    'pending',
  );
  expect(bodies).toEqual([
    { email: 'owned@example.test', password: 'synthetic password', trackStatus: true },
    { receipt: receipt.receipt },
  ]);
  expect(paths).toEqual(['auth/csrf', 'auth/register', 'auth/csrf', 'auth/registration/status']);
});
