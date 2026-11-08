import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRegistrationStatus } from './use-registration-status';
import { FixtureAuthGateway } from '../../../../test-fixtures/auth-gateway';
import { AuthRequestError, type AuthGateway, type RegistrationStatus } from './auth-gateway';
import { VERIFICATION_COMPLETED } from './verification-channel';

let channels: Channel[];
class Channel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  close = vi.fn();
  constructor() {
    channels.push(this);
  }
  post(data: unknown) {
    this.onmessage?.({ data });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  channels = [];
  vi.stubGlobal('BroadcastChannel', Channel);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const receipt = () => ({
  receipt: 'r'.repeat(43),
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
});
function setup(
  read = vi.fn<NonNullable<AuthGateway['readRegistrationStatus']>>().mockResolvedValue('pending'),
) {
  const gateway: AuthGateway = {
    ...new FixtureAuthGateway('success'),
    scope: 'controlled',
    readSession: vi.fn(),
    register: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resendVerification: vi.fn(),
    verifyEmail: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    readRegistrationStatus: read,
  };
  const registration = receipt();
  return { read, gateway, registration };
}
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it('never trusts messages; coalesces hints and stops all polling/listeners on server confirmation', async () => {
  const { read, gateway, registration } = setup();
  const view = renderHook(() => useRegistrationStatus(gateway, registration));
  await tick(0);
  expect(read).toHaveBeenCalledTimes(1);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => {
    for (let i = 0; i < 20; i++) channels[0]!.post({ type: VERIFICATION_COMPLETED });
  });
  expect(view.result.current.status).toBe('pending');
  await tick(2_000);
  expect(read).toHaveBeenCalledTimes(2);
  expect(view.result.current.status).toBe('pending');
  read.mockResolvedValue('verified');
  act(() => channels[0]!.post({ type: VERIFICATION_COMPLETED }));
  await tick(2_000);
  expect(view.result.current.status).toBe('verified');
  expect(channels[0]!.close).toHaveBeenCalled();
  expect(read.mock.calls[0]![1].aborted).toBe(true);
  const count = read.mock.calls.length;
  await tick(900_000);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(read).toHaveBeenCalledTimes(count);
  view.unmount();
});

it('polls without BroadcastChannel, pauses hidden work, rechecks on return, and expires without renewing TTL', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const { read, gateway, registration } = setup();
  const view = renderHook(() => useRegistrationStatus(gateway, registration));
  await tick(0);
  visible.mockReturnValue('hidden');
  await tick(30_000);
  expect(read).toHaveBeenCalledTimes(1);
  visible.mockReturnValue('visible');
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await tick(0);
  expect(read).toHaveBeenCalledTimes(2);
  await tick(15_000);
  expect(read).toHaveBeenCalledTimes(3);
  await tick(855_000);
  expect(view.result.current.status).toBe('expired');
  const count = read.mock.calls.length;
  await tick(30_000);
  expect(read).toHaveBeenCalledTimes(count);
  view.unmount();
});

it('retains pending context after API failure and ignores a stale response after replacement/unmount', async () => {
  const { read, gateway, registration } = setup();
  read.mockRejectedValueOnce(new AuthRequestError('network'));
  const view = renderHook(({ current }) => useRegistrationStatus(gateway, current), {
    initialProps: { current: registration },
  });
  await tick(0);
  expect(view.result.current.error).toContain('Не вдалося отримати відповідь');
  expect(view.result.current.status).toBe('pending');
  let resolve: (status: RegistrationStatus) => void = () => {};
  read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await tick(2_000);
  act(() => view.result.current.recheck());
  await tick(0);
  const oldSignal = read.mock.calls.at(-1)![1];
  view.rerender({ current: { ...registration, receipt: 's'.repeat(43) } });
  await tick(0);
  expect(oldSignal.aborted).toBe(true);
  act(() => {
    resolve('verified');
  });
  await tick(0);
  expect(view.result.current.status).toBe('pending');
  view.unmount();
  expect(read.mock.calls.at(-1)![1].aborted).toBe(true);
});
