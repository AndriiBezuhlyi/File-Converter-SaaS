import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter } from 'axios';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';
import { createAccountGateway } from './account-http-gateway';
import { createApiKeyGateway } from '../../api-keys/lib/api-key-http-gateway';
import { ApiKeyPanel } from '../../api-keys/components/ApiKeyPanel';
import { AutoSaveSetting } from '../components/AutoSaveSetting';
import { DataAccessError } from '../../../shared/lib/data-access-error';

function fixture() {
  let autoSave = false;
  let number = 0;
  let metadata: { prefix: string; createdAt: string } | null = null;
  let fail = false;
  const calls: { method: string; path: string; csrf: boolean }[] = [];
  const adapter: AxiosAdapter = (config) => {
    const method = config.method ?? 'get';
    calls.push({
      method,
      path: config.url ?? '',
      csrf: config.headers.get('X-CSRF-Token') === 'synthetic-csrf',
    });
    if (fail) return Promise.reject(new Error('Controlled connection failure.'));
    let data: unknown;
    let status = 200;
    if (config.url === 'auth/csrf') data = { csrfToken: 'synthetic-csrf' };
    else if (config.url === 'users/me/settings') {
      if (method === 'patch') {
        const body: unknown = JSON.parse(String(config.data));
        if (
          body &&
          typeof body === 'object' &&
          'autoSave' in body &&
          typeof body.autoSave === 'boolean'
        )
          autoSave = body.autoSave;
      }
      data = { autoSave };
    } else if (method === 'get') data = { key: metadata };
    else if (method === 'delete') {
      metadata = null;
      status = 204;
    } else {
      number++;
      metadata = { prefix: 'synthetic-prefix-' + number, createdAt: '2026-11-05T12:00:00Z' };
      data = { metadata, secret: 'one-time-synthetic-secret-' + number };
      status = config.url?.endsWith('/rotate') ? 200 : 201;
    }
    return Promise.resolve({ data, status, statusText: '', headers: {}, config });
  };
  const client = createSessionClient(createHttpClient({ adapter }));
  return {
    account: createAccountGateway(client, 'owned-account'),
    keys: createApiKeyGateway(client, 'owned-account'),
    calls,
    disconnect: () => {
      fail = true;
    },
  };
}
describe('typed account HTTP integration', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
  });
  it('synchronizes the auto-save controls through one query and persists a mutation with CSRF', async () => {
    const f = fixture();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <section aria-label="profile">
          <AutoSaveSetting gateway={f.account} />
        </section>
        <section aria-label="files">
          <AutoSaveSetting gateway={f.account} />
        </section>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const toggles = await screen.findAllByRole('switch');
    await waitFor(() => expect(toggles[0]).toBeEnabled());
    await user.click(toggles[0]!);
    await waitFor(() => {
      for (const toggle of toggles) expect(toggle).toBeChecked();
    });
    expect(f.calls.filter((call) => call.method === 'patch')).toEqual([
      { method: 'patch', path: 'users/me/settings', csrf: true },
    ]);
    view.unmount();
    client.clear();
  });
  it('creates, rotates and revokes through typed adapters; caches metadata without secrets or passwords', async () => {
    const f = fixture();
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <ApiKeyPanel gateway={f.keys} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await screen.findByText('Активного API-ключа немає.');
    for (const [action, secret] of [
      ['Створити ключ', 'one-time-synthetic-secret-1'],
      ['Перевипустити ключ', 'one-time-synthetic-secret-2'],
      ['Відкликати ключ', null],
    ] as const) {
      await user.click(screen.getByRole('button', { name: action }));
      const dialog = within(screen.getByRole('dialog'));
      await user.type(
        dialog.getByLabelText('Поточний пароль', { exact: true }),
        'synthetic-password',
      );
      await user.click(dialog.getByRole('button', { name: action }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      if (secret) {
        // The secret remains in the reveal component, never in TanStack caches.
        expect(
          JSON.stringify(
            client
              .getQueryCache()
              .getAll()
              .map((q) => q.state.data),
          ),
        ).not.toContain(secret);
      }
      expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(
        'synthetic-password',
      );
    }
    expect(await screen.findByText('Активного API-ключа немає.')).toBeInTheDocument();
    view.unmount();
    client.clear();
  });
  it('reports connection failure without caching transport details or replaying an ambiguous mutation', async () => {
    const f = fixture();
    f.disconnect();
    await act(async () => {
      await expect(f.account.setAutoSave(true)).rejects.toEqual(new DataAccessError('network'));
    });
    expect(f.calls).toHaveLength(1);
  });
});
