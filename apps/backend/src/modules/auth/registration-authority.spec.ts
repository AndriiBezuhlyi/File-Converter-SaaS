import 'reflect-metadata';
import { jest } from '@jest/globals';
import { AuthService } from './auth.service.js';
import type { AccountRepository } from './account.repository.js';
import type { PasswordService } from './password.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

it('correlates only a newly committed account, never an existing account from a duplicate attempt', async () => {
  const user = { id: 'new-user', email: 'owned@example.test', sessionVersion: 0 };
  const create = jest.fn<() => Promise<typeof user>>().mockResolvedValue(user);
  const issue = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const hash = jest.fn<() => Promise<string>>().mockResolvedValue('synthetic-hash');
  const tx = { user: { create } };
  const accounts = {
    transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  };
  const service = new AuthService(
    accounts as unknown as AccountRepository,
    { hash } as unknown as PasswordService,
    { issue } as unknown as NotificationsService,
  );
  expect(await service.register(user.email, 'synthetic password')).toEqual(user);
  expect(issue).toHaveBeenCalledWith(tx, user.id, 'email_verification', user.email);
  issue.mockClear();
  create.mockRejectedValueOnce(Object.assign(new Error('Synthetic conflict.'), { code: 'P2002' }));
  expect(await service.register(user.email, 'different synthetic password')).toBeNull();
  expect(issue).not.toHaveBeenCalled();
  expect(hash).toHaveBeenCalledTimes(2);
  create.mockRejectedValueOnce(new Error('Synthetic database failure.'));
  await expect(service.register(user.email, 'synthetic password')).rejects.toThrow(
    'Synthetic database failure.',
  );
});
