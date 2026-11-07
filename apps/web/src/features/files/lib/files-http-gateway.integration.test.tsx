import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter } from 'axios';
import { expect, it } from 'vitest';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';
import { DataAccessError } from '../../../shared/lib/data-access-error';
import { createFilesGateway } from './files-http-gateway';
import { FilesWorkspace } from '../components/FilesWorkspace';

const id = '56f27a77-5cb6-478c-bd20-1164c808944a';
const file = {
  id,
  name: 'synthetic.png',
  format: 'png',
  sizeBytes: 42,
  createdAt: '2026-11-07T10:00:00Z',
  retention: 'saved',
  expiresAt: null,
};

it('maps server items, filters and opaque cursors; protects deletion with fresh CSRF', async () => {
  const calls: { path: string | undefined; params: unknown; csrf: unknown }[] = [];
  const adapter: AxiosAdapter = (config) => {
    calls.push({
      path: config.url,
      params: config.params,
      csrf: config.headers.get('X-CSRF-Token'),
    });
    return Promise.resolve({
      config,
      status: config.method === 'delete' ? 204 : 200,
      statusText: '',
      headers: {},
      data:
        config.url === 'auth/csrf'
          ? { csrfToken: 'synthetic-csrf' }
          : { items: [file], nextCursor: 'opaque+/=' },
    });
  };
  const gateway = createFilesGateway(createSessionClient(createHttpClient({ adapter })), 'owned');
  const signal = new AbortController().signal;
  expect(
    await gateway.list(
      { search: 'synthetic', format: 'png', order: 'oldest', cursor: 'opaque+/=' },
      signal,
    ),
  ).toEqual({ files: [file], nextCursor: 'opaque+/=' });
  expect(calls[0]?.params).toEqual({
    search: 'synthetic',
    format: 'png',
    sort: 'oldest',
    cursor: 'opaque+/=',
  });
  await gateway.list({ search: '', format: 'all', order: 'newest', cursor: null }, signal);
  expect(calls[1]?.params).toEqual({ search: '', sort: 'newest' });
  await gateway.remove(id);
  expect(calls.slice(-2).map((call) => call.path)).toEqual(['auth/csrf', `files/${id}`]);
  expect(calls.at(-1)?.csrf).toBe('synthetic-csrf');
});

it.each([
  [401, 'unauthorized'],
  [403, 'unauthorized'],
  [404, 'not-found'],
  [410, 'expired'],
  [429, 'rate-limited'],
  [503, 'network'],
] as const)('maps files HTTP %s consistently', async (status, kind) => {
  const adapter: AxiosAdapter = (config) =>
    Promise.resolve({
      config,
      status,
      statusText: '',
      headers: {},
      data: {},
    });
  const gateway = createFilesGateway(createSessionClient(createHttpClient({ adapter })), 'owned');
  await expect(gateway.download(id)).rejects.toEqual(new DataAccessError(kind));
});

it('cancels list requests and rejects malformed server pages', async () => {
  const adapter: AxiosAdapter = (config) =>
    Promise.resolve({
      config,
      status: 200,
      statusText: '',
      headers: {},
      data: { items: [{}], nextCursor: null },
    });
  const gateway = createFilesGateway(createSessionClient(createHttpClient({ adapter })), 'owned');
  const controller = new AbortController();
  controller.abort();
  const input = { search: '', format: 'all', order: 'newest', cursor: null } as const;
  await expect(gateway.list(input, controller.signal)).rejects.toBeInstanceOf(DataAccessError);
  await expect(gateway.list(input, new AbortController().signal)).rejects.toEqual(
    new DataAccessError('network'),
  );
});

it('renders HTTP results and synchronizes files and conversion caches after confirmed deletion', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  let removed = false;
  const adapter: AxiosAdapter = (config) => {
    if (config.method === 'delete') removed = true;
    return Promise.resolve({
      config,
      status: config.method === 'delete' ? 204 : 200,
      statusText: '',
      headers: {},
      data:
        config.url === 'auth/csrf'
          ? { csrfToken: 'synthetic-csrf' }
          : { items: removed ? [] : [file], nextCursor: null },
    });
  };
  const gateway = createFilesGateway(createSessionClient(createHttpClient({ adapter })), 'owned');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const jobKey = ['converter', gateway.scope, 'job', id];
  client.setQueryData(jobKey, { status: 'completed' });
  const view = render(
    <QueryClientProvider client={client}>
      <FilesWorkspace gateway={gateway} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole('article', { name: file.name });
  await user.click(screen.getByRole('button', { name: 'Видалити' }));
  await user.click(screen.getByRole('button', { name: 'Видалити файл' }));
  await waitFor(() =>
    expect(screen.queryByRole('article', { name: file.name })).not.toBeInTheDocument(),
  );
  expect(removed).toBe(true);
  expect(client.getQueryState(jobKey)?.isInvalidated).toBe(true);
  view.unmount();
  client.clear();
});
