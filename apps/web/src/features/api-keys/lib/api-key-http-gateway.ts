import { z } from 'zod';
import type { components } from '@converter/contracts';
import type { ApiKeyGateway } from './api-key-gateway';
import type { SessionClient } from '../../../shared/api/session-client';
import { accountRequest } from '../../account/lib/account-http-gateway';

const metadataSchema: z.ZodType<components['schemas']['ApiKeyMetadata']> = z.object({
  prefix: z.string(),
  createdAt: z.string(),
});
const issuedSchema: z.ZodType<components['schemas']['ApiKeyIssued']> = z.object({
  metadata: metadataSchema,
  secret: z.string().min(1),
});
const stateSchema: z.ZodType<components['schemas']['ApiKeyState']> = z.object({
  key: metadataSchema.nullable(),
});
export function createApiKeyGateway(client: SessionClient, scope: string): ApiKeyGateway {
  const issue = (path: string, currentPassword: string) =>
    accountRequest(() =>
      client.mutate(
        path,
        'POST',
        { currentPassword } satisfies components['schemas']['KeyConfirmation'],
        (value) => issuedSchema.parse(value),
        [path.endsWith('/rotate') ? 200 : 201],
      ),
    );
  return {
    scope,
    readKey: (signal) =>
      accountRequest(() =>
        client.http.json({
          path: 'users/me/api-key',
          signal,
          decode: (value) => stateSchema.parse(value).key,
        }),
      ),
    createKey: (password) => issue('users/me/api-key', password),
    rotateKey: (password) => issue('users/me/api-key/rotate', password),
    revokeKey: (currentPassword) =>
      accountRequest(() =>
        client.mutate(
          'users/me/api-key',
          'DELETE',
          { currentPassword } satisfies components['schemas']['KeyConfirmation'],
          () => undefined,
          [204],
        ),
      ),
  };
}
