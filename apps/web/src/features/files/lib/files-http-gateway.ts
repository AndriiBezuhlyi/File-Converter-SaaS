import { z } from 'zod';
import type { components, operations } from '@converter/contracts';
import type { SessionClient } from '../../../shared/api/session-client';
import { ApiRequestError } from '../../../shared/api/api-error';
import { DataAccessError } from '../../../shared/lib/data-access-error';
import type { FilesGateway } from './files-gateway';

const fileSchema: z.ZodType<components['schemas']['SavedFile']> = z.object({
  id: z.string().uuid(),
  name: z.string(),
  format: z.enum(['jpg', 'png', 'pdf']),
  sizeBytes: z.number().int().positive(),
  createdAt: z.string().datetime(),
  retention: z.literal('saved'),
  expiresAt: z.string().datetime().nullable(),
});
const pageSchema: z.ZodType<components['schemas']['SavedFilesPage']> = z.object({
  items: z.array(fileSchema),
  nextCursor: z.string().nullable(),
});

async function request<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 401 || error.status === 403) throw new DataAccessError('unauthorized');
      if (error.status === 404) throw new DataAccessError('not-found');
      if (error.status === 410) throw new DataAccessError('expired');
      if (error.status === 429) throw new DataAccessError('rate-limited');
      if (error.kind !== 'http' || (error.status ?? 0) >= 500) throw new DataAccessError('network');
    }
    throw new DataAccessError('rejected');
  }
}

export function createFilesGateway(client: SessionClient, identity: string): FilesGateway {
  return {
    scope: `${client.http.scope}:${identity}`,
    list: (input, signal) =>
      request(async () => {
        const params = {
          search: input.search,
          sort: input.order,
          ...(input.format !== 'all' ? { format: input.format } : {}),
          ...(input.cursor !== null ? { cursor: input.cursor } : {}),
        } satisfies NonNullable<operations['filesList']['parameters']['query']>;
        const page = await client.http.json({
          path: 'files',
          params,
          signal,
          decode: (value) => pageSchema.parse(value),
        });
        return { files: page.items, nextCursor: page.nextCursor };
      }),
    download: (id) =>
      request(() =>
        client.http.download({
          path: `files/${id}/download`,
          fallbackName: 'conversion',
          contentTypes: ['image/jpeg', 'image/png', 'application/pdf'],
        }),
      ),
    remove: (id) =>
      request(() => client.mutate(`files/${id}`, 'DELETE', undefined, () => undefined, [204])),
  };
}
