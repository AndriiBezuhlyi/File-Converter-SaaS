import { describe, expect, it } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';
import { createAuthGateway } from '../../auth/lib/auth-http-gateway';
import { createConversionGateway } from './conversion-http-gateway';

function harness() {
  let reads = 0;
  let release = () => {};
  let fail = false;
  const adapter: AxiosAdapter = async (config) => {
    let data: unknown = { csrfToken: 'synthetic-token' };
    if (config.url === 'auth/session') {
      reads++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (fail) throw new Error('offline');
      data = { kind: 'anonymous' };
    } else if (config.url === 'guest-session') {
      data = { trialState: 'available', activeConversionId: null };
    }
    return { data, status: 200, statusText: '', headers: {}, config };
  };
  const client = createSessionClient(createHttpClient({ adapter }));
  return {
    client,
    reads: () => reads,
    release: () => release(),
    fail: () => {
      fail = true;
    },
  };
}

describe('in-flight session reads', () => {
  it('shares auth and eligibility reads, but never reuses a settled session', async () => {
    const h = harness();
    const auth = createAuthGateway(h.client).readSession(new AbortController().signal);
    const access = createConversionGateway(h.client, 'anonymous').readAccess(
      new AbortController().signal,
    );
    expect(h.reads()).toBe(1);
    h.release();
    await expect(auth).resolves.toEqual({ kind: 'anonymous' });
    await expect(access).resolves.toEqual({ kind: 'guest', trial: 'available', jobId: null });
    const next = h.client.readSession(new AbortController().signal);
    expect(h.reads()).toBe(2);
    h.release();
    await next;
  });

  it('cancels one reader without cancelling the other', async () => {
    const h = harness();
    const controller = new AbortController();
    const first = h.client.readSession(controller.signal);
    const second = h.client.readSession(new AbortController().signal);
    controller.abort();
    await expect(first).rejects.toMatchObject({ kind: 'cancelled' });
    h.release();
    await expect(second).resolves.toEqual({ kind: 'anonymous' });
    expect(h.reads()).toBe(1);
  });

  it('does not share identities between independent clients or tabs', async () => {
    const a = harness();
    const b = harness();
    const reads = [
      a.client.readSession(new AbortController().signal),
      b.client.readSession(new AbortController().signal),
    ];
    expect([a.reads(), b.reads()]).toEqual([1, 1]);
    a.release();
    b.release();
    await Promise.all(reads);
  });

  it('clears a failed read so recovery contacts the server again', async () => {
    const h = harness();
    const first = h.client.readSession(new AbortController().signal);
    h.fail();
    h.release();
    await expect(first).rejects.toMatchObject({ kind: 'network' });
    const next = h.client.readSession(new AbortController().signal);
    expect(h.reads()).toBe(2);
    h.release();
    await expect(next).rejects.toMatchObject({ kind: 'network' });
  });

  it.each(['auth/login', 'auth/logout', 'auth/password-reset/confirm'])(
    'discards an in-flight identity across %s',
    async (path) => {
      const h = harness();
      const old = h.client.readSession(new AbortController().signal);
      const rejected = expect(old).rejects.toMatchObject({ kind: 'cancelled' });
      await h.client.mutate(path, 'POST', {}, () => undefined);
      h.release();
      await rejected;
      const next = h.client.readSession(new AbortController().signal);
      expect(h.reads()).toBe(2);
      h.release();
      await next;
    },
  );
});
