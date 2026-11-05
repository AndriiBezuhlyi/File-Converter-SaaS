import { z } from 'zod';
import type { components } from '@converter/contracts';
import type { AccountGateway } from './account-gateway';
import { profileSchema, type SessionClient } from '../../../shared/api/session-client';
import { ApiRequestError } from '../../../shared/api/api-error';
import { DataAccessError } from '../../../shared/lib/data-access-error';

export const settingsSchema: z.ZodType<components['schemas']['AccountSettings']> = z.object({
  autoSave: z.boolean(),
});
const resultSchema: z.ZodType<components['schemas']['ProfileUpdateResult']> = z.object({
  profile: profileSchema,
  verificationRequired: z.boolean(),
});
export async function accountRequest<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (
        ['network', 'timeout', 'invalid-response'].includes(error.kind) ||
        (error.status !== undefined && error.status >= 500)
      )
        throw new DataAccessError('network');
      if (error.status === 401) throw new DataAccessError('unauthorized');
      if (error.code === 'CURRENT_PASSWORD_INVALID') throw new DataAccessError('confirmation');
      if (error.status === 429) throw new DataAccessError('rate-limited');
    }
    throw new DataAccessError('rejected');
  }
}
export function createAccountGateway(client: SessionClient, scope: string): AccountGateway {
  return {
    scope,
    readProfile: (signal) =>
      accountRequest(() =>
        client.http.json({
          path: 'users/me',
          signal,
          decode: (value) => profileSchema.parse(value),
        }),
      ),
    readSettings: (signal) =>
      accountRequest(() =>
        client.http.json({
          path: 'users/me/settings',
          signal,
          decode: (value) => settingsSchema.parse(value),
        }),
      ),
    setAutoSave: (autoSave) =>
      accountRequest(() =>
        client.mutate(
          'users/me/settings',
          'PATCH',
          { autoSave } satisfies components['schemas']['AccountSettings'],
          (value) => settingsSchema.parse(value),
        ),
      ),
    updateProfile: (input) =>
      accountRequest(() =>
        client.mutate(
          'users/me',
          'PATCH',
          input satisfies components['schemas']['ProfileUpdateRequest'],
          (value) => resultSchema.parse(value),
        ),
      ),
    changePassword: (input) =>
      accountRequest(() =>
        client.mutate(
          'users/me/password',
          'POST',
          input satisfies components['schemas']['PasswordChangeRequest'],
          () => undefined,
          [204],
        ),
      ),
  };
}
