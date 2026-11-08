import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { useAuth } from '../lib/auth-context';
import { FixtureAuthGateway } from '../../../../test-fixtures/auth-gateway';

it('retains the receipt through anonymous refresh/errors and clears it after an authenticated identity appears', async () => {
  const gateway = new FixtureAuthGateway('success');
  const read = vi.spyOn(gateway, 'readSession').mockResolvedValue({ kind: 'anonymous' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <AuthProvider gateway={gateway}>{children}</AuthProvider>
      </QueryClientProvider>
    );
  }
  const view = renderHook(useAuth, { wrapper: Wrapper });
  try {
    await waitFor(() => expect(view.result.current.status).toBe('ready'));
    const receipt = {
      receipt: 'r'.repeat(43),
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
    act(() => {
      view.result.current.rememberRegistration?.(receipt);
    });
    await act(async () => {
      await view.result.current.refreshSession();
    });
    expect(view.result.current.pendingRegistration).toEqual(receipt);
    read.mockRejectedValueOnce(new Error('Synthetic network failure.'));
    await act(async () => {
      await expect(view.result.current.refreshSession()).rejects.toThrow(
        'Synthetic network failure.',
      );
    });
    expect(view.result.current.pendingRegistration).toEqual(receipt);
    read.mockResolvedValue({ kind: 'authenticated', email: 'owned@example.test' });
    await act(async () => {
      await view.result.current.refreshSession();
    });
    await waitFor(() => expect(view.result.current.pendingRegistration).toBeUndefined());
  } finally {
    view.unmount();
    client.clear();
    read.mockRestore();
  }
});
