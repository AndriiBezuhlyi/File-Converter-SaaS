import { useEffect, useRef, useState } from 'react';
import {
  authErrorMessage,
  type AuthGateway,
  type PendingRegistration,
  type RegistrationStatus,
} from './auth-gateway';
import { VERIFICATION_CHANNEL, VERIFICATION_COMPLETED } from './verification-channel';

export function useRegistrationStatus(gateway: AuthGateway, registration: PendingRegistration) {
  const [state, setState] = useState<{
    status: RegistrationStatus;
    checking: boolean;
    error: string | null;
  }>({
    status: 'pending',
    checking: false,
    error: null,
  });
  const recheck = useRef<() => void>(() => {});

  useEffect(() => {
    let live = true;
    let done = false;
    let busy = false;
    let lastCheck = -Infinity;
    const controller = new AbortController();
    let channel: BroadcastChannel | undefined;
    let polling: number | undefined;
    let expiry: number | undefined;
    let coalesced: number | undefined;
    let queued = false;
    let messagePending = false;
    const expiresAt = Date.parse(registration.expiresAt);

    function stop() {
      done = true;
      window.clearInterval(polling);
      window.clearTimeout(expiry);
      window.clearTimeout(coalesced);
      window.removeEventListener('focus', trigger);
      document.removeEventListener('visibilitychange', trigger);
      channel?.close();
      controller.abort();
    }
    function finish(status: RegistrationStatus) {
      if (!live || done) return;
      setState({ status, checking: false, error: null });
      stop();
    }
    async function check() {
      if (!live || done) return;
      if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
        finish('expired');
        return;
      }
      if (busy || Date.now() - lastCheck < 2_000) return;
      busy = true;
      lastCheck = Date.now();
      setState({ status: 'pending', checking: true, error: null });
      try {
        const status = await gateway.readRegistrationStatus!(
          registration.receipt,
          controller.signal,
        );
        if (!live || done) return;
        if (Date.now() >= expiresAt) finish('expired');
        else if (status !== 'pending') finish(status);
        else setState({ status, checking: false, error: null });
      } catch (error) {
        if (live && !done)
          setState({ status: 'pending', checking: false, error: authErrorMessage(error) });
      } finally {
        busy = false;
        if (queued) {
          queued = false;
          trigger();
        }
      }
    }
    function trigger() {
      if (!live || done || (document.visibilityState === 'hidden' && !messagePending)) return;
      if (busy) {
        queued = true;
        return;
      }
      const delay = 2_000 - (Date.now() - lastCheck);
      if (delay > 0) {
        window.clearTimeout(coalesced);
        coalesced = window.setTimeout(trigger, delay);
        return;
      }
      messagePending = false;
      void check();
    }
    recheck.current = trigger;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) finish('expired');
    else {
      expiry = window.setTimeout(
        () => finish('expired'),
        Math.min(expiresAt - Date.now(), 15 * 60_000),
      );
      polling = window.setInterval(trigger, 15_000);
      window.addEventListener('focus', trigger);
      document.addEventListener('visibilitychange', trigger);
      try {
        channel = new BroadcastChannel(VERIFICATION_CHANNEL);
        channel.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (
            data &&
            typeof data === 'object' &&
            'type' in data &&
            data.type === VERIFICATION_COMPLETED
          ) {
            messagePending = true;
            trigger();
          }
        };
      } catch {
        // Poll/recheck remain available without a channel.
      }
      trigger();
    }
    return () => {
      live = false;
      recheck.current = () => {};
      stop();
    };
  }, [gateway, registration]);

  return { ...state, recheck: () => recheck.current() };
}
