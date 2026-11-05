import { z } from 'zod';
import type { components } from '@converter/contracts';
import type { HttpClient } from './http-client';

export const profileSchema: z.ZodType<components['schemas']['Profile']> = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
});
export const sessionSchema: z.ZodType<components['schemas']['Session']> = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('anonymous') }),
    z.object({ kind: z.literal('authenticated'), user: profileSchema, expiresAt: z.string() }),
  ],
);
const csrfSchema: z.ZodType<components['schemas']['Csrf']> = z.object({
  csrfToken: z.string().min(1),
});

export function createSessionClient(http: HttpClient) {
  return {
    http,
    async mutate<T>(
      path: string,
      method: 'POST' | 'PATCH' | 'DELETE',
      body: unknown,
      decode: (value: unknown) => T,
      statuses = [200],
    ) {
      // Obtain the current synchronizer token after any SID rotation; never cache it in Query.
      const token = await http.json({
        path: 'auth/csrf',
        decode: (value) => csrfSchema.parse(value),
      });
      return http.json({
        path,
        method,
        body,
        csrf: { headerName: 'X-CSRF-Token', value: token.csrfToken },
        decode,
        statuses,
      });
    },
  };
}
export type SessionClient = ReturnType<typeof createSessionClient>;
