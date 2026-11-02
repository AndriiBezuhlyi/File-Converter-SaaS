import { AxiosError, CanceledError, type AxiosAdapter } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api-error';
import { createHttpClient } from './http-client';
import { createHealthClient } from './health-client';
import { downloadName } from './download-name';

function reply(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn<AxiosAdapter>((config) =>
    Promise.resolve({
      config,
      data,
      status,
      statusText: '',
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );
}

describe('same-origin HTTP transport', () => {
  it('rejects external, ambiguous and traversal URLs before transmitting anything', async () => {
    for (const basePath of ['https://example.test/api/v1', '//example.test/api', '/api/../v1', ''])
      expect(() => createHttpClient({ basePath })).toThrow(ApiRequestError);
    const adapter = reply({});
    const http = createHttpClient({ adapter });
    for (const path of [
      'https://example.test',
      '/health/live',
      '../live',
      'health?token=value',
      '%2f',
    ])
      await expect(http.json({ path, decode: () => null })).rejects.toMatchObject({
        kind: 'configuration',
      });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('uses generated health paths, cookies, bounded timeout and the caller cancellation signal', async () => {
    const adapter = reply({ status: 'ok', ignored: 'discarded' });
    const http = createHttpClient({ basePath: '/api/v1/', adapter });
    const controller = new AbortController();
    expect(await createHealthClient(http).live(controller.signal)).toEqual({ status: 'ok' });
    const config = adapter.mock.calls[0]![0];
    expect(config).toMatchObject({
      baseURL: '/api/v1/',
      url: 'health/live',
      method: 'get',
      timeout: 30_000,
      withCredentials: true,
      withXSRFToken: false,
      signal: controller.signal,
    });
    expect(config.headers.get('Authorization')).toBeUndefined();
    expect(config.headers.get('X-API-Key')).toBeUndefined();
    expect(() => createHttpClient({ timeoutMs: 0 })).toThrow(ApiRequestError);
  });

  it('requires explicit CSRF, preserves FormData and forwards only measured upload bytes', async () => {
    const progress = vi.fn();
    const adapter = reply(undefined, 204);
    const http = createHttpClient({ adapter });
    const request = { path: 'fixture-write', method: 'POST' as const, decode: () => undefined };
    // @ts-expect-error Cookie mutations require an explicitly supplied CSRF token.
    await expect(http.json(request)).rejects.toMatchObject({ kind: 'configuration' });
    await expect(
      http.json({ ...request, csrf: { headerName: 'X-API-Key', value: 'synthetic' } }),
    ).rejects.toMatchObject({ kind: 'configuration' });
    expect(adapter).not.toHaveBeenCalled();
    adapter.mockImplementationOnce((config) => {
      config.onUploadProgress?.({ loaded: 3, total: 6, bytes: 3, lengthComputable: true });
      config.onUploadProgress?.({ loaded: 4, bytes: 1, lengthComputable: false });
      return Promise.resolve({ config, data: undefined, status: 204, statusText: '', headers: {} });
    });
    const body = new FormData();
    body.append('file', new File(['owned synthetic data'], 'fixture.jpg'));
    body.append('targetFormat', 'png');
    await http.json({
      ...request,
      csrf: { headerName: 'X-Fixture-CSRF', value: 'synthetic-token' },
      body,
      statuses: [204],
      onUploadProgress: progress,
    });
    const config = adapter.mock.calls[0]![0];
    const sent: unknown = config.data;
    expect(sent).toBe(body);
    expect(config.headers.get('X-Fixture-CSRF')).toBe('synthetic-token');
    expect(progress.mock.calls).toEqual([[{ loaded: 3, total: 6 }], [{ loaded: 4 }]]);
  });

  it('sanitizes HTTP failures and never retries an ambiguous mutation', async () => {
    const adapter = reply({ error: { message: 'private-response-body' } }, 403);
    const http = createHttpClient({ adapter });
    const failure: unknown = await http
      .json({ path: 'health/live', decode: () => null })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'http', status: 403 });
    expect(JSON.stringify(failure)).not.toContain('private-response-body');
    adapter.mockImplementation((config) =>
      Promise.reject(new AxiosError('synthetic-secret', 'ERR_NETWORK', config)),
    );
    adapter.mockClear();
    const lost: unknown = await http
      .json({
        path: 'fixture-write',
        method: 'POST',
        csrf: { headerName: 'X-Fixture-CSRF', value: 'synthetic-secret' },
        body: { password: 'synthetic-secret' },
        decode: () => undefined,
      })
      .catch((error: unknown) => error);
    expect(lost).toMatchObject({ kind: 'network' });
    expect(lost).not.toHaveProperty('config');
    expect(lost).not.toHaveProperty('cause');
    expect(JSON.stringify(lost)).not.toContain('synthetic-secret');
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('distinguishes cancellation and timeouts without retaining Axios exceptions', async () => {
    for (const [error, kind] of [
      [new CanceledError('private-cancel-detail'), 'cancelled'],
      [new AxiosError('private-timeout-detail', 'ECONNABORTED'), 'timeout'],
    ] as const) {
      const adapter = vi.fn<AxiosAdapter>(() => Promise.reject(error));
      const http = createHttpClient({ adapter });
      await expect(createHealthClient(http).live()).rejects.toMatchObject({ kind });
      expect(adapter).toHaveBeenCalledTimes(1);
    }
  });

  it('decodes operational 503 data but rejects malformed or contradictory success responses', async () => {
    const adapter = reply({ status: 'unavailable', dependencies: { database: 'down' } }, 503);
    const api = createHealthClient(createHttpClient({ adapter }));
    expect(await api.ready()).toEqual({
      status: 'unavailable',
      dependencies: { database: 'down' },
    });
    for (const data of [
      { status: 'unavailable', dependencies: {} },
      { status: 'ok', dependencies: { database: 'private-value' } },
      '<html>proxy error</html>',
    ]) {
      adapter.mockImplementationOnce(reply(data));
      await expect(api.ready()).rejects.toMatchObject({ kind: 'invalid-response', status: 200 });
    }
  });

  it('returns validated Blob downloads with safe UTF-8 names and deterministic fallbacks', async () => {
    const blob = new Blob(['synthetic PNG fixture'], { type: 'image/png' });
    const adapter = reply(blob, 200, {
      'content-type': 'image/png',
      'content-disposition': "attachment; filename*=UTF-8''..%2F%D1%84%D0%B0%D0%B9%D0%BB.png",
    });
    const http = createHttpClient({ adapter });
    expect(
      await http.download({
        path: 'fixture-download',
        fallbackName: 'result.png',
        contentTypes: ['image/png'],
      }),
    ).toEqual({ blob, name: 'файл.png' });
    expect(downloadName("attachment; filename*=UTF-8''%ZZ; filename=plain.png", 'fallback')).toBe(
      'plain.png',
    );
    expect(downloadName('attachment; filename="../unsafe\u0000.png"', 'fallback')).toBe(
      'unsafe.png',
    );
    expect(downloadName(undefined, '../fallback.png')).toBe('fallback.png');
    expect(downloadName('attachment; filename=".."', '')).toBe('result');
  });

  it('does not treat expired, denied, empty or JSON error downloads as successful files', async () => {
    for (const [status, type, blob, kind] of [
      [410, 'application/pdf', new Blob(['expired']), 'http'],
      [404, 'application/pdf', new Blob(['denied']), 'http'],
      [200, 'application/json', new Blob(['{"error":"private"}']), 'invalid-response'],
      [200, 'image/png', new Blob([]), 'invalid-response'],
    ] as const) {
      const adapter = reply(blob, status, { 'content-type': type });
      await expect(
        createHttpClient({ adapter }).download({
          path: 'fixture-download',
          fallbackName: 'result.png',
          contentTypes: ['image/png'],
        }),
      ).rejects.toMatchObject({ kind, status });
    }
  });
});
