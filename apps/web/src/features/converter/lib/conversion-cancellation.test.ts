import { expect, it } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { createConversionGateway } from './conversion-http-gateway';
import { createSessionClient } from '../../../shared/api/session-client';
import { createHttpClient } from '../../../shared/api/http-client';

it('aborts an upload after CSRF without retrying an ambiguous POST', async () => {
  let posts = 0;
  const controller = new AbortController();
  const adapter: AxiosAdapter = (config) => {
    if (config.url === 'conversions') {
      posts++;
      expect(config.signal?.aborted).toBe(false);
      controller.abort();
    }
    return Promise.resolve({
      config,
      status: 200,
      statusText: '',
      headers: {},
      data: { csrfToken: 'synthetic' },
    });
  };
  const gateway = createConversionGateway(
    createSessionClient(createHttpClient({ adapter })),
    'owned',
  );
  expect(
    await gateway.submit(
      { file: new File(['synthetic'], 'synthetic.jpg'), sourceFormat: 'jpg', targetFormat: 'png' },
      () => {},
      controller.signal,
    ),
  ).toEqual({ kind: 'unknown' });
  expect(posts).toBe(1);
});
