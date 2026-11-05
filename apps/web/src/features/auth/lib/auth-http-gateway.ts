import { z } from 'zod';
import type { AuthGateway } from './auth-gateway';
import { AuthRequestError } from './auth-gateway';
import { sessionSchema, type SessionClient } from '../../../shared/api/session-client';
import { ApiRequestError } from '../../../shared/api/api-error';

export function createAuthGateway(client: SessionClient): AuthGateway {
  async function run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.code === 'EMAIL_NOT_VERIFIED') throw error;
        if (['network', 'timeout', 'invalid-response'].includes(error.kind))
          throw new AuthRequestError('network');
        if (error.status === 429) throw new AuthRequestError('rate-limited');
        if (error.code === 'INVALID_CREDENTIALS') throw new AuthRequestError('invalid-credentials');
        if (error.code === 'TOKEN_INVALID') throw new AuthRequestError('invalid-token');
      }
      throw new AuthRequestError('rejected');
    }
  }
  const empty = () => undefined;
  const accepted = (value: unknown) => {
    z.object({ status: z.literal('accepted') }).parse(value);
  };
  return {
    scope: client.http.scope,
    readSession: (signal) =>
      run(async () => {
        const session = await client.http.json({
          path: 'auth/session',
          signal,
          decode: (value) => sessionSchema.parse(value),
        });
        return session.kind === 'authenticated'
          ? { kind: 'authenticated', email: session.user.email }
          : session;
      }),
    register: (input) => run(() => client.mutate('auth/register', 'POST', input, accepted, [202])),
    async signIn(input) {
      try {
        await run(() =>
          client.mutate('auth/login', 'POST', input, (value) => sessionSchema.parse(value)),
        );
        return 'signed-in';
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'EMAIL_NOT_VERIFIED')
          return 'verification-required';
        throw error;
      }
    },
    signOut: () => run(() => client.mutate('auth/logout', 'POST', {}, empty, [204])),
    resendVerification: (email) =>
      run(() => client.mutate('auth/verification/resend', 'POST', { email }, accepted, [202])),
    verifyEmail: (token) =>
      run(() => client.mutate('auth/verify-email', 'POST', { token }, empty, [204])),
    requestPasswordReset: (email) =>
      run(() => client.mutate('auth/password-reset/request', 'POST', { email }, accepted, [202])),
    resetPassword: (token, newPassword) =>
      run(() =>
        client.mutate('auth/password-reset/confirm', 'POST', { token, newPassword }, empty, [204]),
      ),
  };
}
