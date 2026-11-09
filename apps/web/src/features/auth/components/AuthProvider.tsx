import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthContext } from '../lib/auth-context';
import type { AuthGateway, PendingRegistration } from '../lib/auth-gateway';

export function AuthProvider({
  gateway,
  children,
}: PropsWithChildren<{ gateway?: AuthGateway | undefined }>) {
  return gateway ? (
    <ConnectedAuthProvider key={gateway.scope} gateway={gateway}>
      {children}
    </ConnectedAuthProvider>
  ) : (
    children
  );
}
function ConnectedAuthProvider({ gateway, children }: PropsWithChildren<{ gateway: AuthGateway }>) {
  const [pendingRegistration, rememberRegistration] = useState<PendingRegistration>();
  const client = useQueryClient();
  const options = {
    queryKey: ['auth', gateway.scope, 'session'],
    queryFn: ({ signal }: { signal: AbortSignal }) => gateway.readSession(signal),
    retry: false,
    staleTime: 0,
  };
  const session = useQuery(options);
  if (session.data?.kind === 'authenticated' && pendingRegistration)
    rememberRegistration(undefined);
  const identity = session.isError
    ? 'unavailable'
    : session.data?.kind === 'authenticated'
      ? session.data.email
      : session.data?.kind;
  const previousIdentity = useRef(identity);
  useEffect(() => {
    if (identity !== undefined && previousIdentity.current !== identity) {
      const previous = previousIdentity.current;
      previousIdentity.current = identity;
      if (previous !== undefined) {
        const privateQueries = {
          predicate: (query: { queryKey: readonly unknown[] }) =>
            query.queryKey[0] !== 'auth' &&
            (query.queryKey[1] === previous ||
              query.queryKey[1] === `${gateway.scope}:${previous}`),
        };
        void client.cancelQueries(privateQueries).then(() => client.removeQueries(privateQueries));
      }
    }
  }, [client, gateway.scope, identity]);
  async function refreshSession() {
    // Drop account-scoped data after a confirmed identity mutation; guest credentials stay server-owned.
    const otherQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== 'auth',
    };
    await client.cancelQueries(otherQueries);
    client.removeQueries(otherQueries);
    await client.cancelQueries({ queryKey: options.queryKey });
    return client.fetchQuery(options);
  }
  return (
    <AuthContext
      value={{
        gateway,
        session: session.isError ? null : (session.data ?? null),
        sessionExpiresAt: session.dataUpdatedAt ? gateway.sessionExpiresAt : undefined,
        status: session.isPending ? 'pending' : session.isError ? 'error' : 'ready',
        refreshSession,
        pendingRegistration:
          session.data?.kind === 'authenticated' ? undefined : pendingRegistration,
        rememberRegistration,
      }}
    >
      {children}
    </AuthContext>
  );
}
