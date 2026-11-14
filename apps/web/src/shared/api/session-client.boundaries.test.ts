import { describe, expect, it } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { createHttpClient } from './http-client';
import { createSessionClient } from './session-client';

function fixture() {
  let email: string | null = 'first@example.test';
  const pending: (() => void)[] = [];
  const adapter: AxiosAdapter = async (config) => {
    const identity = email;
    await new Promise<void>((resolve) => pending.push(resolve));
    return {
      config,
      status: 200,
      statusText: '',
      headers: {},
      data: identity
        ? {
            kind: 'authenticated',
            user: { id: identity, email: identity, displayName: '' },
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }
        : { kind: 'anonymous' },
    };
  };
  return {
    client: createSessionClient(createHttpClient({ adapter })),
    pending,
    identity: (value: string | null) => {
      email = value;
    },
  };
}

describe('session reader cancellation boundaries', () => {
  it.each([null, 'second@example.test'])(
    'does not rejoin an abandoned read after the principal becomes %s',
    async (identity) => {
      const h = fixture();
      const controller = new AbortController();
      const old = h.client.readSession(controller.signal);
      const cancelled = expect(old).rejects.toMatchObject({ kind: 'cancelled' });
      controller.abort();
      await cancelled;
      h.identity(identity);
      const fresh = h.client.readSession(new AbortController().signal);
      h.pending.forEach((resolve) => resolve());
      const session = await fresh;
      expect(h.pending).toHaveLength(2);
      expect(session.kind === 'authenticated' ? session.user.email : null).toBe(identity);
    },
  );

  it('retains coalescing while another reader still owns the request', async () => {
    const h = fixture();
    const controller = new AbortController();
    const first = h.client.readSession(controller.signal);
    const cancelled = expect(first).rejects.toMatchObject({ kind: 'cancelled' });
    const second = h.client.readSession(new AbortController().signal);
    controller.abort();
    await cancelled;
    const third = h.client.readSession(new AbortController().signal);
    h.pending.forEach((resolve) => resolve());
    expect(h.pending).toHaveLength(1);
    await expect(second).resolves.toMatchObject({ kind: 'authenticated' });
    await expect(third).resolves.toMatchObject({ kind: 'authenticated' });
  });

  it('detaches only after both coalesced query owners cancel', async () => {
    const h = fixture();
    const controllers = [new AbortController(), new AbortController()];
    const old = controllers.map((controller) => h.client.readSession(controller.signal));
    const rejected = old.map((read) => expect(read).rejects.toMatchObject({ kind: 'cancelled' }));
    controllers.forEach((controller) => controller.abort());
    await Promise.all(rejected);
    h.identity(null);
    const fresh = h.client.readSession(new AbortController().signal);
    h.pending.forEach((resolve) => resolve());
    await expect(fresh).resolves.toEqual({ kind: 'anonymous' });
    expect(h.pending).toHaveLength(2);
  });
});
