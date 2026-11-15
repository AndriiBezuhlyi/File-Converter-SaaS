import { expect, it } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';
import { createConversionGateway } from './conversion-http-gateway';

function fixture() {
  const id = '56f27a77-5cb6-478c-bd20-1164c808944a';
  let trial = 'available';
  let session: 'anonymous' | 'authenticated' = 'anonymous';
  let denied = 0;
  let availability = 'available';
  let submissions = 0;
  const summary = {
    id,
    sourceFormat: 'jpg',
    targetFormat: 'png',
    createdAt: '2026-11-15T12:00:00Z',
    saveResult: false,
  };
  const adapter: AxiosAdapter = (config) => {
    let status = 200;
    let data: unknown;
    if (config.url === 'auth/session')
      data =
        session === 'anonymous'
          ? { kind: session }
          : {
              kind: session,
              user: { id, email: 'owned@example.test', displayName: '' },
              expiresAt: '2099-01-01T00:00:00Z',
            };
    else if (config.url === 'auth/csrf') data = { csrfToken: 'synthetic' };
    else if (config.url === 'guest-session') data = { trialState: trial, activeConversionId: null };
    else if (config.url === 'conversions') {
      submissions++;
      trial = 'consumed';
      status = 202;
      data = { ...summary, status: 'queued' };
    } else if (denied) {
      status = denied;
      data = {
        error: {
          code: denied === 401 ? 'GUEST_CREDENTIAL_INVALID' : 'NOT_FOUND',
          message: 'Unavailable',
        },
      };
    } else
      data = {
        ...summary,
        status: 'completed',
        completedAt: summary.createdAt,
        error: null,
        resultAvailability: availability,
        result: {
          id,
          owner: 'guest',
          name: 'owned.png',
          format: 'png',
          sizeBytes: 42,
          retention: 'temporary',
          expiresAt: '2099-01-01T00:00:00Z',
          availability,
        },
      };
    return Promise.resolve({ config, status, statusText: '', headers: {}, data });
  };
  const client = createSessionClient(createHttpClient({ adapter }));
  const gateway = createConversionGateway(client, 'anonymous');
  const signal = new AbortController().signal;
  return {
    id,
    gateway,
    client,
    signal,
    setTrial: (value: string) => {
      trial = value;
    },
    setSession: () => {
      session = 'authenticated';
    },
    deny: (value: number) => {
      denied = value;
    },
    unavailable: (value: string) => {
      availability = value;
    },
    submissions: () => submissions,
  };
}

async function accepted(f: ReturnType<typeof fixture>) {
  await f.gateway.readAccess(f.signal);
  await f.gateway.submit(
    { file: new File(['synthetic'], 'owned.jpg'), sourceFormat: 'jpg', targetFormat: 'png' },
    () => {},
  );
}

it('recovers an accepted guest result across route remounts without restoring allowance or browser storage', async () => {
  const f = fixture();
  await accepted(f);
  expect(await f.gateway.readAccess(f.signal)).toEqual({
    kind: 'guest',
    trial: 'consumed',
    jobId: f.id,
  });
  expect(await f.gateway.readJob(f.id, f.signal)).toMatchObject({
    status: 'completed',
    result: { availability: 'available' },
  });
  expect(f.submissions()).toBe(1);
  expect(await createConversionGateway(f.client, 'anonymous').readAccess(f.signal)).toEqual({
    kind: 'guest',
    trial: 'consumed',
    jobId: null,
  });
});

it.each([401, 403, 404, 410])('forgets a denied result after HTTP %s', async (status) => {
  const f = fixture();
  await accepted(f);
  f.deny(status);
  await expect(f.gateway.readJob(f.id, f.signal)).rejects.toThrow();
  expect(await f.gateway.readAccess(f.signal)).toMatchObject({ trial: 'consumed', jobId: null });
});

it.each(['expired', 'deleted'])(
  'preserves server-reported %s availability',
  async (availability) => {
    const f = fixture();
    await accepted(f);
    f.unavailable(availability);
    expect(await f.gateway.readJob(f.id, f.signal)).toMatchObject({
      status: 'completed',
      result: { availability },
    });
  },
);

it('forgets the hint on a reset guest context or authenticated identity', async () => {
  const f = fixture();
  await accepted(f);
  f.setTrial('available');
  expect(await f.gateway.readAccess(f.signal)).toMatchObject({ jobId: null });
  await accepted(f);
  f.setSession();
  expect(await f.gateway.readAccess(f.signal)).toEqual({ kind: 'account', jobId: null });
});

it('remembers a server-authorized guest result resumed from an existing conversion URL', async () => {
  const f = fixture();
  f.setTrial('consumed');
  await f.gateway.readJob(f.id, f.signal);
  expect(await f.gateway.readAccess(f.signal)).toEqual({
    kind: 'guest',
    trial: 'consumed',
    jobId: f.id,
  });
});
