import { z } from 'zod';
import type { components } from '@converter/contracts';
import type { HttpClient } from './http-client';
import { ApiRequestError } from './api-error';

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
  // Share only an in-flight read, never a settled identity or a cross-tab cache.
  let sessionRead:
    | {
        controller: AbortController;
        promise: Promise<components['schemas']['Session']>;
        readers: number;
      }
    | undefined;
  return {
    http,
    async readSession(signal: AbortSignal) {
      if (signal.aborted) throw new ApiRequestError('cancelled');
      if (!sessionRead) {
        const controller = new AbortController();
        const read = {
          controller,
          readers: 0,
          promise: http.json({
            path: 'auth/session',
            signal: controller.signal,
            decode: (value) => sessionSchema.parse(value),
          }),
        };
        sessionRead = read;
        // Rejection is handled by each reader; cleanup must not create an unhandled rejection.
        const clear = () => {
          if (sessionRead === read) sessionRead = undefined;
        };
        void read.promise.then(clear, clear);
      }
      const read = sessionRead;
      read.readers++;
      return new Promise<components['schemas']['Session']>((resolve, reject) => {
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          signal.removeEventListener('abort', abort);
          read.readers--;
          // A cancelled query must not lend its old identity snapshot to a fresh query.
          if (!read.readers && sessionRead === read) {
            sessionRead = undefined;
            read.controller.abort();
          }
        };
        const abort = () => {
          release();
          reject(new ApiRequestError('cancelled'));
        };
        signal.addEventListener('abort', abort, { once: true });
        void read.promise.then(
          (value) => {
            release();
            if (!signal.aborted) resolve(value);
          },
          (error: unknown) => {
            release();
            reject(error instanceof Error ? error : new ApiRequestError('network'));
          },
        );
      });
    },
    async mutate<T>(
      path: string,
      method: 'POST' | 'PATCH' | 'DELETE',
      body: unknown,
      decode: (value: unknown) => T,
      statuses = [200],
      signal?: AbortSignal,
    ) {
      const changesIdentity = ['auth/login', 'auth/logout', 'auth/password-reset/confirm'].includes(
        path,
      );
      const invalidateSessionRead = () => {
        sessionRead?.controller.abort();
        sessionRead = undefined;
      };
      if (changesIdentity) invalidateSessionRead();
      try {
        // Obtain the current synchronizer token after any SID rotation; never cache it in Query.
        const token = await http.json({
          path: 'auth/csrf',
          ...(signal ? { signal } : {}),
          decode: (value) => csrfSchema.parse(value),
        });
        return await http.json({
          path,
          method,
          body,
          csrf: { headerName: 'X-CSRF-Token', value: token.csrfToken },
          decode,
          statuses,
          ...(signal ? { signal } : {}),
        });
      } finally {
        if (changesIdentity) invalidateSessionRead();
      }
    },
  };
}
export type SessionClient = ReturnType<typeof createSessionClient>;
