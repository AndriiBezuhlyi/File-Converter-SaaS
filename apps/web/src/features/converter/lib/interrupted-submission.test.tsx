import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { useConversionFlow } from './use-conversion-flow';
import {
  ConversionRequestError,
  type ConversionGateway,
  type SubmissionOutcome,
} from './conversion-gateway';

it('does not restore a private job cache after an identity remount aborts a pending upload', async () => {
  let finish!: (result: SubmissionOutcome) => void;
  let signal: AbortSignal | undefined;
  const gateway: ConversionGateway = {
    scope: 'synthetic:old-account',
    readAccess: () => Promise.resolve({ kind: 'account', jobId: null }),
    submit: (_selection, _progress, abort) => {
      signal = abort;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    readJob: vi.fn(),
    download: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
  const onJobId = vi.fn();
  const hook = renderHook(() => useConversionFlow(gateway, null, onJobId), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  try {
    await waitFor(() => expect(hook.result.current.access.isSuccess).toBe(true));
    act(() =>
      hook.result.current.submit({
        file: new File(['synthetic'], 'owned.jpg', { type: 'image/jpeg' }),
        sourceFormat: 'jpg',
        targetFormat: 'png',
      }),
    );
    await waitFor(() => expect(signal).toBeDefined());
    hook.unmount();
    expect(signal?.aborted).toBe(true);
    client.removeQueries({ queryKey: ['converter', gateway.scope] });
    await act(async () => {
      finish({
        kind: 'accepted',
        job: {
          id: 'old-job',
          sourceName: 'owned.jpg',
          sourceFormat: 'jpg',
          targetFormat: 'png',
          status: 'queued',
        },
      });
      await Promise.resolve();
    });
    expect(client.getQueryData(['converter', gateway.scope, 'job', 'old-job'])).toBeUndefined();
    expect(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.data),
    ).not.toContainEqual(expect.objectContaining({ kind: 'accepted' }));
    expect(onJobId).not.toHaveBeenCalled();
  } finally {
    hook.unmount();
    client.clear();
  }
});

it('backs polling off after a transport error and resumes the known job without submission', async () => {
  vi.useFakeTimers();
  const processing = {
    id: 'known-job',
    sourceName: null,
    sourceFormat: 'jpg',
    targetFormat: 'png',
    status: 'processing',
  } as const;
  const readJob = vi
    .fn<ConversionGateway['readJob']>()
    .mockResolvedValue(processing)
    .mockResolvedValueOnce(processing)
    .mockRejectedValueOnce(new ConversionRequestError('network'));
  const submit = vi.fn<ConversionGateway['submit']>();
  const gateway: ConversionGateway = {
    scope: 'synthetic:polling',
    readAccess: () => Promise.resolve({ kind: 'account', jobId: null }),
    submit,
    readJob,
    download: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(() => useConversionFlow(gateway, 'known-job', vi.fn()), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  try {
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(readJob).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(readJob).toHaveBeenCalledTimes(2);
    const failed = client.getQueryState(['converter', gateway.scope, 'job', 'known-job'])!;
    expect(failed.error).toBeInstanceOf(ConversionRequestError);
    expect(hook.result.current.job.data?.status).toBe('processing');
    await act(() => vi.advanceTimersByTimeAsync(failed.errorUpdatedAt + 30_000 - Date.now() - 1));
    expect(readJob).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(readJob).toHaveBeenCalledTimes(3);
    expect(submit).not.toHaveBeenCalled();
  } finally {
    hook.unmount();
    client.clear();
    vi.useRealTimers();
  }
});
