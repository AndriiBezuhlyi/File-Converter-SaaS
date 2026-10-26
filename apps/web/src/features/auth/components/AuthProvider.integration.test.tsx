import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { useAuth } from '../lib/auth-context';
import { AuthRequestError } from '../lib/auth-gateway';
import { FixtureAuthGateway } from '../../../../test-fixtures/auth-gateway';

const clients: QueryClient[] = [];
function mount() {
  const gateway = new FixtureAuthGateway('signed-in');
  const read = vi.spyOn(gateway, 'readSession').mockResolvedValue({
    kind: 'authenticated',
    email: 'reader@example.test',
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <AuthProvider gateway={gateway}>{children}</AuthProvider>
      </QueryClientProvider>
    );
  }
  return { ...renderHook(useAuth, { wrapper: Wrapper }), client, read };
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

it('cancels private reads and prevents a late old-account response from repopulating the cache', async () => {
  const { client, read, result } = mount();
  await waitFor(() => expect(result.current.status).toBe('ready'));
  client.setQueryData(['settings', 'previous-account'], { autoSave: true });
  let finish: (value: string[]) => void = () => {};
  let signal: AbortSignal | undefined;
  const pending = client
    .fetchQuery({
      queryKey: ['files', 'previous-account'],
      queryFn: (context) => {
        signal = context.signal;
        return new Promise<string[]>((resolve) => {
          finish = resolve;
        });
      },
    })
    .catch(() => undefined);
  expect(signal?.aborted).toBe(false);
  read.mockResolvedValue({ kind: 'anonymous' });
  await act(() => result.current.refreshSession());
  await waitFor(() => expect(result.current.session).toEqual({ kind: 'anonymous' }));
  expect(signal?.aborted).toBe(true);
  expect(client.getQueryData(['settings', 'previous-account'])).toBeUndefined();
  finish(['late synthetic file']);
  await pending;
  expect(client.getQueryData(['files', 'previous-account'])).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(2);
});

it('clears account data and hides a stale authenticated session when synchronization fails', async () => {
  const { client, read, result } = mount();
  await waitFor(() => expect(result.current.session?.kind).toBe('authenticated'));
  client.setQueryData(['files', 'previous-account'], ['synthetic file']);
  client.setQueryData(['api-keys', 'previous-account'], { prefix: 'synthetic-prefix' });
  read.mockRejectedValue(new AuthRequestError('network'));
  await act(async () => {
    await expect(result.current.refreshSession()).rejects.toBeInstanceOf(AuthRequestError);
  });
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.session).toBeNull();
  expect(client.getQueryData(['files', 'previous-account'])).toBeUndefined();
  expect(client.getQueryData(['api-keys', 'previous-account'])).toBeUndefined();
  expect(read).toHaveBeenCalledTimes(2);
});
