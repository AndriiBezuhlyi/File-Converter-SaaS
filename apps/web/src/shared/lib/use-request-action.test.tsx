import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useRequestAction } from './use-request-action';

function deferred() {
  let resolve: (value: string) => void = () => {};
  let reject: (cause: Error) => void = () => {};
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it('blocks a second request before a rerender and reports only the confirmed result', async () => {
  const pending = deferred();
  const request = vi.fn(() => pending.promise);
  const success = vi.fn();
  const { result } = renderHook(() => useRequestAction(() => 'Request failed.'), {
    wrapper: StrictMode,
  });
  let completed: Promise<void> | undefined;
  act(() => {
    completed = result.current.run(request, success);
    void result.current.run(request, success);
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.current.pending).toBe(true);
  expect(success).not.toHaveBeenCalled();
  await act(async () => {
    pending.resolve('confirmed');
    await completed;
  });
  expect(success).toHaveBeenCalledExactlyOnceWith('confirmed');
  expect(result.current.pending).toBe(false);
});

it('uses safe error copy, clears old feedback and permits an explicit retry', async () => {
  const cause = new Error('Synthetic internal diagnostic');
  const request = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(cause)
    .mockResolvedValueOnce('confirmed');
  const success = vi.fn();
  const failure = vi.fn();
  const { result } = renderHook(() => useRequestAction(() => 'Please retry.'));
  await act(() => result.current.run(request, success, failure));
  expect(result.current.error).toBe('Please retry.');
  expect(result.current.pending).toBe(false);
  expect(success).not.toHaveBeenCalled();
  expect(failure).toHaveBeenCalledExactlyOnceWith(cause);
  act(() => result.current.clearError());
  expect(result.current.error).toBeNull();
  await act(() => result.current.run(request, success, failure));
  expect(request).toHaveBeenCalledTimes(2);
  expect(success).toHaveBeenCalledExactlyOnceWith('confirmed');
  expect(failure).toHaveBeenCalledTimes(1);
});

it.each(['resolve', 'reject'] as const)(
  'ignores late %s callbacks after unmount',
  async (outcome) => {
    const pending = deferred();
    const describe = vi.fn(() => 'Request failed.');
    const success = vi.fn();
    const failure = vi.fn();
    const { result, unmount } = renderHook(() => useRequestAction(describe));
    let completed: Promise<void> | undefined;
    act(() => {
      completed = result.current.run(() => pending.promise, success, failure);
    });
    unmount();
    await act(async () => {
      if (outcome === 'resolve') pending.resolve('late response');
      else pending.reject(new Error('Late failure'));
      await completed;
    });
    expect(success).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(describe).not.toHaveBeenCalled();
  },
);
