import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { useAuth } from '../lib/auth-context';
import { FixtureAuthGateway } from '../../../../test-fixtures/auth-gateway';

it.each(['expiry', 'failure'])(
  'purges transport-scoped private caches on background session %s',
  async (outcome) => {
    const gateway = new FixtureAuthGateway('signed-in');
    const read = vi
      .spyOn(gateway, 'readSession')
      .mockResolvedValue({ kind: 'authenticated', email: 'owned@example.test' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <QueryClientProvider client={client}>
          <AuthProvider gateway={gateway}>{children}</AuthProvider>
        </QueryClientProvider>
      );
    }
    const view = renderHook(useAuth, { wrapper: Wrapper });
    await waitFor(() => expect(view.result.current.session?.kind).toBe('authenticated'));
    client.setQueryData(['converter', `${gateway.scope}:owned@example.test`, 'job', 'owned-job'], {
      status: 'completed',
    });
    client.setQueryData(['files', `${gateway.scope}:owned@example.test`, 'list'], ['owned']);
    client.setQueryData(['settings', 'owned@example.test'], { autoSave: true });
    if (outcome === 'expiry') read.mockResolvedValue({ kind: 'anonymous' });
    else read.mockRejectedValue(new Error('Synthetic session connection failure.'));
    await act(() => client.invalidateQueries({ queryKey: ['auth', gateway.scope, 'session'] }));
    await waitFor(() =>
      expect(view.result.current.status).toBe(outcome === 'expiry' ? 'ready' : 'error'),
    );
    await waitFor(() =>
      expect(
        client.getQueryCache().findAll({ predicate: (query) => query.queryKey[0] !== 'auth' }),
      ).toHaveLength(0),
    );
    view.unmount();
    client.clear();
    read.mockRestore();
  },
);
