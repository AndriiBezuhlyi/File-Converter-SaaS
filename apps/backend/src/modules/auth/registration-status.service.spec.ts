import 'reflect-metadata';
import { jest } from '@jest/globals';
import { RegistrationStatusService, REGISTRATION_TTL_MS } from './registration-status.service.js';
import type { RedisService } from '../../infrastructure/redis/redis.service.js';
import type { AccountRepository } from './account.repository.js';
import { AuthError } from './auth-error.js';

function setup() {
  const records = new Map<string, string>();
  const set = jest.fn<(key: string, value: string, options: { PX: number }) => Promise<string>>(
    (key, value) => {
      records.set(key, value);
      return Promise.resolve('OK');
    },
  );
  const get = jest.fn<(key: string) => Promise<string | null>>((key) =>
    Promise.resolve(records.get(key) ?? null),
  );
  const findUnique = jest
    .fn<
      () => Promise<{ email: string; sessionVersion: number; emailVerifiedAt: Date | null } | null>
    >()
    .mockResolvedValue({ email: 'owned@example.test', sessionVersion: 0, emailVerifiedAt: null });
  const service = new RegistrationStatusService(
    { sessionPrefix: 'test:session:', client: { set, get } } as unknown as RedisService,
    { client: { user: { findUnique } } } as unknown as AccountRepository,
  );
  return { service, records, set, get, findUnique };
}
const account = { id: 'owned-user', email: 'owned@example.test', sessionVersion: 0 };
afterEach(() => jest.restoreAllMocks());

it('isolates concurrent receipts by session and registration; only DB state confirms verification', async () => {
  const { service, records, set, findUnique } = setup();
  const [real, decoy, other] = await Promise.all([
    service.issue('original-session', account),
    service.issue('original-session', null),
    service.issue('other-session', account),
  ]);
  expect(real.receipt).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(new Set([real.receipt, decoy.receipt, other.receipt]).size).toBe(3);
  expect(records.size).toBe(3);
  expect(JSON.stringify([...records])).not.toContain(account.email);
  expect(JSON.stringify([...records])).not.toContain(real.receipt);
  expect(JSON.stringify([...records])).not.toContain('original-session');
  expect(set.mock.calls.every(([, , options]) => options.PX === REGISTRATION_TTL_MS)).toBe(true);
  expect(await service.read('original-session', real.receipt)).toEqual({ status: 'pending' });
  expect(await service.read('other-session', real.receipt)).toEqual({ status: 'expired' });
  expect(await service.read('original-session', 'x'.repeat(43))).toEqual({ status: 'expired' });
  findUnique.mockResolvedValue({ ...account, emailVerifiedAt: new Date() });
  expect(await service.read('original-session', real.receipt)).toEqual({ status: 'verified' });
  expect(await service.read('original-session', decoy.receipt)).toEqual({ status: 'pending' });
  expect(await service.read('original-session', real.receipt)).toEqual({ status: 'verified' });
  expect(set).toHaveBeenCalledTimes(3); // Replays are read-only and never renew TTL.
  expect(await service.read('rotated-session', real.receipt)).toEqual({ status: 'expired' });
});

it('expires absolutely, including when expiry races the database read', async () => {
  const { service, findUnique } = setup();
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  const real = await service.issue('session', account);
  findUnique.mockImplementation(() => {
    clock.mockReturnValue(now + REGISTRATION_TTL_MS);
    return Promise.resolve({ ...account, emailVerifiedAt: new Date() });
  });
  expect(await service.read('session', real.receipt)).toEqual({ status: 'expired' });
  findUnique.mockClear();
  expect(await service.read('session', real.receipt)).toEqual({ status: 'expired' });
  expect(findUnique).not.toHaveBeenCalled();
});

it('invalidates deleted accounts, changed email and changed security version, including email-change verification', async () => {
  const { service, findUnique } = setup();
  const real = await service.issue('session', account);
  for (const changed of [
    null,
    { ...account, email: 'changed@example.test', emailVerifiedAt: new Date() },
    { ...account, sessionVersion: 1, emailVerifiedAt: new Date() },
  ]) {
    findUnique.mockResolvedValue(changed);
    expect(await service.read('session', real.receipt)).toEqual({ status: 'expired' });
  }
});

it('fails closed on Redis/DB/corrupt-record errors without guessing status or compensating registration', async () => {
  const { service, findUnique, set, get, records } = setup();
  const real = await service.issue('session', account);
  const unavailable = new AuthError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable.');
  findUnique.mockRejectedValue(new Error('Synthetic database failure.'));
  await expect(service.read('session', real.receipt)).rejects.toEqual(unavailable);
  get.mockRejectedValueOnce(new Error('Synthetic Redis failure.'));
  await expect(service.read('session', real.receipt)).rejects.toEqual(unavailable);
  for (const key of records.keys()) records.set(key, '{}');
  await expect(service.read('session', real.receipt)).rejects.toEqual(unavailable);
  set.mockRejectedValueOnce(new Error('Synthetic Redis write failure.'));
  await expect(service.issue('session', account)).rejects.toEqual(unavailable);
});
