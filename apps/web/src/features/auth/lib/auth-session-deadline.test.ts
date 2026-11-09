import { expect, it } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { createAuthGateway } from './auth-http-gateway';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';

it('exposes only the current server session deadline without changing the session view model', async () => {
  let authenticated = true;
  let expiresAt = '2030-01-01T12:00:00Z';
  const adapter: AxiosAdapter = (config) =>
    Promise.resolve({
      config,
      status: 200,
      statusText: '',
      headers: {},
      data: authenticated
        ? {
            kind: 'authenticated',
            user: { id: 'owned', email: 'owned@example.test', displayName: '' },
            expiresAt,
          }
        : { kind: 'anonymous' },
    });
  const gateway = createAuthGateway(createSessionClient(createHttpClient({ adapter })));
  const signal = new AbortController().signal;
  await expect(gateway.readSession(signal)).resolves.toEqual({
    kind: 'authenticated',
    email: 'owned@example.test',
  });
  expect(gateway.sessionExpiresAt).toBe(Date.parse(expiresAt));
  expiresAt = '2030-01-01T13:00:00Z';
  await gateway.readSession(signal);
  expect(gateway.sessionExpiresAt).toBe(Date.parse(expiresAt));
  authenticated = false;
  await gateway.readSession(signal);
  expect(gateway.sessionExpiresAt).toBeUndefined();
});
