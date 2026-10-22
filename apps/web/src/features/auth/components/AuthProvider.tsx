import type { PropsWithChildren } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthContext } from '../lib/auth-context';
import type { AuthGateway } from '../lib/auth-gateway';

export function AuthProvider({
  gateway,
  children,
}: PropsWithChildren<{ gateway?: AuthGateway | undefined }>) {
  return gateway ? (
    <ConnectedAuthProvider gateway={gateway}>{children}</ConnectedAuthProvider>
  ) : (
    children
  );
}
function ConnectedAuthProvider({ gateway, children }: PropsWithChildren<{ gateway: AuthGateway }>) {
  const client = useQueryClient();
  const options = {
    queryKey: ['auth', gateway.scope, 'session'],
    queryFn: ({ signal }: { signal: AbortSignal }) => gateway.readSession(signal),
    retry: false,
    staleTime: 0,
  };
  const session = useQuery(options);
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
        status: session.isPending ? 'pending' : session.isError ? 'error' : 'ready',
        refreshSession,
      }}
    >
      {children}
    </AuthContext>
  );
}
