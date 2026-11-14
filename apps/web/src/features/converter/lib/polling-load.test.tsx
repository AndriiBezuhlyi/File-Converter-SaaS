import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useConversionFlow } from './use-conversion-flow';
import type { ConversionGateway, ConversionJob } from './conversion-gateway';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const active: ConversionJob = {
  id: firstId,
  status: 'processing',
  sourceName: null,
  sourceFormat: 'jpg',
  targetFormat: 'png',
};
const clients: QueryClient[] = [];
function fixture(readJob: ConversionGateway['readJob']) {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const submit = vi.fn<ConversionGateway['submit']>();
  const gateway: ConversionGateway = {
    scope: 'load-review',
    readJob,
    readAccess: vi.fn().mockResolvedValue({ kind: 'account', jobId: null }),
    submit,
    download: vi.fn(),
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, gateway, wrapper, submit };
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});

it('bounds the extra status load over a five-minute active conversion', async () => {
  const times: number[] = [];
  const readJob = vi.fn<ConversionGateway['readJob']>().mockImplementation(() => {
    times.push(Date.now());
    return Promise.resolve(active);
  });
  const { gateway, wrapper, submit } = fixture(readJob);
  renderHook(() => useConversionFlow(gateway, firstId, () => {}), { wrapper });
  await advance(300_000);
  const baselineCount = 1 + Math.floor(300_000 / 1500);
  expect(times.length).toBeGreaterThanOrEqual(baselineCount);
  expect(times.length).toBeLessThanOrEqual(baselineCount + 2);
  expect(times.slice(-5).map((time, i, tail) => (i ? time - tail[i - 1]! : 1500))).toEqual([
    1500, 1500, 1500, 1500, 1500,
  ]);
  expect(submit).not.toHaveBeenCalled();
});

it('keeps concurrent job IDs isolated without overlapping slow status reads', async () => {
  const activeById = new Map<string, number>();
  const maximumById = new Map<string, number>();
  const readJob = vi.fn<ConversionGateway['readJob']>().mockImplementation((id) => {
    const count = (activeById.get(id) ?? 0) + 1;
    activeById.set(id, count);
    maximumById.set(id, Math.max(count, maximumById.get(id) ?? 0));
    return new Promise((resolve) =>
      setTimeout(() => {
        activeById.set(id, (activeById.get(id) ?? 0) - 1);
        resolve({ ...active, id });
      }, 2500),
    );
  });
  const { gateway, wrapper, submit } = fixture(readJob);
  renderHook(
    () => {
      useConversionFlow(gateway, firstId, () => {});
      useConversionFlow(gateway, secondId, () => {});
    },
    { wrapper },
  );
  await advance(15_000);
  expect(maximumById.get(firstId)).toBe(1);
  expect(maximumById.get(secondId)).toBe(1);
  expect(readJob.mock.calls.filter(([id]) => id === firstId).length).toBeGreaterThan(1);
  expect(readJob.mock.calls.filter(([id]) => id === secondId).length).toBeGreaterThan(1);
  expect(submit).not.toHaveBeenCalled();
});
