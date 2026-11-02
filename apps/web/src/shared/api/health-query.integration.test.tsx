import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, CanceledError, type AxiosAdapter } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import { createHttpClient } from './http-client';
import { createHealthClient } from './health-client';
import { readinessQuery, useApiReadiness } from './health-query';

const clients: QueryClient[] = [];
function context() {
  const client = new QueryClient();
  clients.push(client);
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});

it('updates a real Query cache across readiness, dependency failure, connectivity error and recovery', async () => {
  let status = 200;
  let data: unknown = { status: 'ok', dependencies: { database: 'up' } };
  let offline = false;
  const adapter = vi.fn<AxiosAdapter>((config) => {
    if (offline)
      return Promise.reject(new AxiosError('private-network-details', 'ERR_NETWORK', config));
    return Promise.resolve({ config, data, status, statusText: '', headers: {} });
  });
  const api = createHealthClient(createHttpClient({ adapter }));
  const { client, wrapper } = context();
  const { result } = renderHook(() => useApiReadiness(api), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.status).toBe('ok');
  await client.fetchQuery(readinessQuery(api));
  expect(adapter).toHaveBeenCalledTimes(1); // Fresh data is reused.
  status = 503;
  data = { status: 'unavailable', dependencies: { database: 'down' } };
  await act(() => client.invalidateQueries({ queryKey: readinessQuery(api).queryKey }));
  await waitFor(() => expect(result.current.data?.status).toBe('unavailable'));
  expect(result.current.isSuccess).toBe(true); // A valid dependency outage is operational data.
  offline = true;
  await act(() => result.current.refetch());
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toMatchObject({ kind: 'network' });
  expect(adapter).toHaveBeenCalledTimes(3);
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state),
    ),
  ).not.toContain('private-network-details');
  offline = false;
  status = 200;
  data = { status: 'ok', dependencies: { database: 'up' } };
  await act(() => result.current.refetch());
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.status).toBe('ok');
});

it('passes Query cancellation to the transport when the last observer unmounts', async () => {
  let signal: { readonly aborted: boolean } | undefined;
  const adapter = vi.fn<AxiosAdapter>((config) => {
    signal = config.signal;
    return new Promise((_resolve, reject) => {
      config.signal?.addEventListener?.('abort', () =>
        reject(new CanceledError('cancelled fixture')),
      );
    });
  });
  const api = createHealthClient(createHttpClient({ adapter }));
  const { wrapper } = context();
  const { unmount } = renderHook(() => useApiReadiness(api), { wrapper });
  await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted).toBe(true);
});

it('polls every 10 seconds, backs off to 30 seconds after a request failure and stops on unmount', async () => {
  vi.useFakeTimers();
  let offline = false;
  const adapter = vi.fn<AxiosAdapter>((config) =>
    offline
      ? Promise.reject(new AxiosError('synthetic outage', 'ERR_NETWORK', config))
      : Promise.resolve({
          config,
          data: { status: 'ok', dependencies: {} },
          status: 200,
          statusText: '',
          headers: {},
        }),
  );
  const api = createHealthClient(createHttpClient({ adapter }));
  const { wrapper } = context();
  const { result, unmount } = renderHook(() => useApiReadiness(api), { wrapper });
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(adapter).toHaveBeenCalledTimes(1);
  offline = true;
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(adapter).toHaveBeenCalledTimes(2);
  expect(result.current.isError).toBe(true);
  offline = false;
  await act(() => vi.advanceTimersByTimeAsync(29_998));
  expect(adapter).toHaveBeenCalledTimes(2);
  await act(() => vi.advanceTimersByTimeAsync(10));
  expect(adapter).toHaveBeenCalledTimes(3);
  expect(result.current.data?.status).toBe('ok');
  unmount();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(adapter).toHaveBeenCalledTimes(3);
});
