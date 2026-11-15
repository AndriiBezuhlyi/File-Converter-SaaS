import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter } from 'axios';
import { expect, it } from 'vitest';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';
import { createFilesGateway } from '../lib/files-http-gateway';
import { FilesWorkspace } from './FilesWorkspace';

it('renames via CSRF-protected PATCH, keeps extension and refreshes filtered caches', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  let name = 'Фото été.png';
  const file = () => ({
    id: '56f27a77-5cb6-478c-bd20-1164c808944a',
    name,
    format: 'png',
    sizeBytes: 42,
    createdAt: '2026-11-13T10:00:00Z',
    retention: 'saved',
    expiresAt: null,
  });
  const patches: unknown[] = [];
  const adapter: AxiosAdapter = (config) => {
    if (config.method === 'patch') {
      expect(config.headers.get('X-CSRF-Token')).toBe('synthetic-csrf');
      const body = JSON.parse(config.data as string) as { name: string };
      patches.push(body);
      name = body.name;
    }
    return Promise.resolve({
      config,
      status: 200,
      statusText: '',
      headers: {},
      data:
        config.url === 'auth/csrf'
          ? { csrfToken: 'synthetic-csrf' }
          : config.method === 'patch'
            ? file()
            : { items: [file()], nextCursor: null },
    });
  };
  const gateway = createFilesGateway(createSessionClient(createHttpClient({ adapter })), 'owner');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const jobKey = ['converter', gateway.scope, 'job', 'synthetic'];
  client.setQueryData(jobKey, { status: 'completed' });
  const view = render(
    <QueryClientProvider client={client}>
      <FilesWorkspace gateway={gateway} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole('article', { name });
  await user.click(screen.getByRole('button', { name: 'Перейменувати' }));
  const field = screen.getByRole('textbox', { name: 'Назва файлу' });
  expect(field).toHaveFocus();
  expect(field).toHaveValue('Фото été');
  await user.clear(field);
  await user.type(field, 'Нова назва café');
  await user.click(screen.getByRole('button', { name: 'Зберегти назву' }));
  await screen.findByRole('article', { name: 'Нова назва café.png' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(patches).toEqual([{ name: 'Нова назва café.png' }]);
  expect(client.getQueryState(jobKey)?.isInvalidated).toBe(true);
  view.unmount();
  client.clear();
});
