import { describe, expect, it } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { createConversionGateway } from './conversion-http-gateway';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';
import { ConversionRequestError } from './conversion-gateway';

const id = '56f27a77-5cb6-478c-bd20-1164c808944a';
const base = {
  id,
  sourceFormat: 'jpg',
  targetFormat: 'png',
  createdAt: '2026-11-05T12:00:00Z',
  saveResult: false,
};
const selection = {
  file: new File(['synthetic'], 'owned.jpg'),
  sourceFormat: 'jpg' as const,
  targetFormat: 'png' as const,
};

describe('real conversion HTTP gateway', () => {
  it('bootstraps a guest with CSRF, submits once, maps terminal ownership and downloads actual response bytes', async () => {
    const mutations: string[] = [];
    const adapter: AxiosAdapter = (config) => {
      let data: unknown;
      const headers: Record<string, string> = {};
      let status = 200;
      if (config.url === 'auth/session') data = { kind: 'anonymous' };
      else if (config.url === 'auth/csrf') data = { csrfToken: 'owned-synthetic-token' };
      else if (config.url === 'guest-session')
        data = { trialState: 'available', activeConversionId: null };
      else if (config.url === 'conversions') {
        data = { ...base, status: 'queued' };
        status = 202;
      } else if (config.url?.endsWith('/download')) {
        data = new Blob(['real-response-fixture'], { type: 'image/png' });
        headers['content-type'] = 'image/png';
        headers['content-disposition'] = 'attachment; filename="owned.png"';
      } else
        data = {
          ...base,
          status: 'completed',
          completedAt: '2026-11-05T12:00:10Z',
          error: null,
          resultAvailability: 'available',
          result: {
            id,
            owner: 'guest',
            name: 'owned.png',
            format: 'png',
            sizeBytes: 42,
            retention: 'temporary',
            expiresAt: '2026-11-05T13:00:10Z',
            availability: 'available',
          },
        };
      if (config.method === 'post') {
        mutations.push(config.url!);
        expect(config.headers.get('X-CSRF-Token')).toBe('owned-synthetic-token');
      }
      return Promise.resolve({ data, status, statusText: '', headers, config });
    };
    const gateway = createConversionGateway(
      createSessionClient(createHttpClient({ adapter })),
      'anonymous',
    );
    expect(await gateway.readAccess(new AbortController().signal)).toEqual({
      kind: 'guest',
      trial: 'available',
      jobId: null,
    });
    expect((await gateway.submit(selection, () => {})).kind).toBe('accepted');
    expect(await gateway.readJob(id, new AbortController().signal)).toMatchObject({
      status: 'completed',
      result: { owner: 'guest' },
    });
    expect((await gateway.download(id)).name).toBe('owned.png');
    expect(mutations).toEqual(['guest-session', 'conversions']);
  });
  it.each([
    [401, 'GUEST_CONVERSION_LIMIT_REACHED', 'sign-in-required'],
    [422, 'INVALID_FILE', 'rejected'],
    [429, 'RATE_LIMITED', 'rejected'],
  ] as const)(
    'maps definitive submission rejection %s without replay',
    async (status, code, expected) => {
      let posts = 0;
      const adapter: AxiosAdapter = (config) => {
        if (config.url === 'conversions') posts++;
        return Promise.resolve({
          data: config.url === 'auth/csrf' ? { csrfToken: 'synthetic' } : { error: { code } },
          status: config.url === 'auth/csrf' ? 200 : status,
          statusText: '',
          headers: {},
          config,
        });
      };
      const gateway = createConversionGateway(
        createSessionClient(createHttpClient({ adapter })),
        'anonymous',
      );
      expect((await gateway.submit(selection, () => {})).kind).toBe(expected);
      expect(posts).toBe(1);
    },
  );
  it('keeps ambiguous acceptance separate and maps expired downloads', async () => {
    const adapter: AxiosAdapter = (config) =>
      Promise.resolve({
        data: config.url === 'auth/csrf' ? { csrfToken: 'synthetic' } : {},
        status: config.url?.endsWith('/download') ? 410 : 200,
        statusText: '',
        headers: {},
        config,
      });
    const gateway = createConversionGateway(
      createSessionClient(createHttpClient({ adapter })),
      'anonymous',
    );
    expect(await gateway.submit(selection, () => {})).toEqual({ kind: 'unknown' });
    await expect(gateway.download(id)).rejects.toEqual(new ConversionRequestError('expired'));
  });
});
