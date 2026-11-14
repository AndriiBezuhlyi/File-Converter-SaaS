import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConversionFlow } from './use-conversion-flow';
import {
  ConversionRequestError,
  type ConversionGateway,
  type ConversionJob,
} from './conversion-gateway';

const id = '11111111-1111-4111-8111-111111111111';
const active: ConversionJob = {
  id,
  status: 'processing',
  sourceName: null,
  sourceFormat: 'jpg',
  targetFormat: 'png',
};
const clients: QueryClient[] = [];
function setup(readJob = vi.fn<ConversionGateway['readJob']>().mockResolvedValue(active)) {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const gateway: ConversionGateway = {
    scope: 'polling-test',
    readAccess: vi.fn().mockResolvedValue({ kind: 'account', jobId: null }),
    readJob,
    submit: vi.fn(),
    download: vi.fn(),
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useConversionFlow(gateway, id, () => {}), { wrapper });
  return { readJob, client };
}
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('bounded polling acceleration', () => {
  it('refreshes immediately, limits the fast window, then keeps the sustained 1500ms rate', async () => {
    const { readJob } = setup();
    await tick();
    expect(readJob).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) await tick(1000);
    expect(readJob).toHaveBeenCalledTimes(6);
    await tick(1000);
    expect(readJob).toHaveBeenCalledTimes(6);
    await tick(500);
    expect(readJob).toHaveBeenCalledTimes(7);
    await tick(6000);
    expect(readJob).toHaveBeenCalledTimes(11);
  });

  it('preserves the 30-second network backoff', async () => {
    const readJob = vi
      .fn<ConversionGateway['readJob']>()
      .mockRejectedValueOnce(new ConversionRequestError('network'))
      .mockResolvedValue(active);
    setup(readJob);
    await tick();
    await tick(29999);
    expect(readJob).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(readJob).toHaveBeenCalledTimes(2);
  });

  it.each(['failed', 'completed'] as const)(
    'stops after authoritative %s state',
    async (status) => {
      const readJob = vi.fn<ConversionGateway['readJob']>().mockResolvedValue(
        status === 'failed'
          ? { ...active, status, reason: 'unknown' }
          : {
              ...active,
              status,
              result: {
                name: 'synthetic.png',
                sizeBytes: 100,
                format: 'png',
                owner: 'account',
                retention: { kind: 'saved' },
                availability: 'available',
              },
            },
      );
      setup(readJob);
      await tick();
      await tick(60000);
      expect(readJob).toHaveBeenCalledTimes(1);
    },
  );

  it('pauses while hidden and immediately refreshes when focus returns', async () => {
    const { readJob } = setup();
    await tick();
    act(() => focusManager.setFocused(false));
    await tick(10000);
    expect(readJob).toHaveBeenCalledTimes(1);
    act(() => focusManager.setFocused(true));
    await tick();
    expect(readJob).toHaveBeenCalledTimes(2);
  });

  it('does not overlap slow status requests', async () => {
    let resolve!: (job: ConversionJob) => void;
    const readJob = vi.fn<ConversionGateway['readJob']>().mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    setup(readJob);
    await tick(10000);
    expect(readJob).toHaveBeenCalledTimes(1);
    act(() => resolve(active));
    await tick();
    await tick(1000);
    expect(readJob).toHaveBeenCalledTimes(2);
  });
});
