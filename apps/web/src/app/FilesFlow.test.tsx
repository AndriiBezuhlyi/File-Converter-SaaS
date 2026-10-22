import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { FixtureAccountGateway } from '../../test-fixtures/account-gateway';
import { DataAccessError } from '../shared/lib/data-access-error';

const clients: QueryClient[] = [];
beforeAll(async () => {
  await Promise.all([import('../pages/account/AccountPage'), import('../pages/files/FilesPage')]);
});
function mount(gateway: FixtureAccountGateway, path = '/files') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App
          authGateway={gateway}
          accountGateway={gateway}
          apiKeyGateway={gateway}
          filesGateway={gateway}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function rows() {
  const list = await screen.findByRole('list', { name: 'Збережені файли' });
  await within(list).findByRole('article', { name: 'example-image.png' });
  return within(list);
}

it('paginates without duplicate IDs and resets the cursor for filtering, ordering and debounced search', async () => {
  const gateway = new FixtureAccountGateway('success');
  const list = vi.spyOn(gateway, 'list');
  mount(gateway);
  const user = userEvent.setup();
  const files = await rows();
  expect(files.getAllByRole('article')).toHaveLength(3);
  await user.click(screen.getByRole('button', { name: 'Показати ще' }));
  await waitFor(() => expect(files.getAllByRole('article')).toHaveLength(5));
  expect(screen.queryByRole('button', { name: 'Показати ще' })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Тип файлу'), 'pdf');
  expect(await screen.findByRole('article', { name: 'notes.pdf' })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('За датою'), 'oldest');
  await waitFor(() =>
    expect(list.mock.lastCall?.[0]).toMatchObject({ cursor: null, format: 'pdf', order: 'oldest' }),
  );
  await user.type(screen.getByLabelText('Пошук за назвою'), ' ANOTHER ');
  await waitFor(() =>
    expect(list.mock.lastCall?.[0]).toMatchObject({ search: 'ANOTHER', cursor: null }),
  );
  expect(await screen.findByRole('article', { name: 'another-notes.pdf' })).toBeInTheDocument();
  expect(screen.queryByRole('article', { name: 'notes.pdf' })).not.toBeInTheDocument();
});

it('distinguishes no matching files from an empty library and can clear filters', async () => {
  const gateway = new FixtureAccountGateway('success');
  mount(gateway);
  const user = userEvent.setup();
  await rows();
  await user.type(screen.getByLabelText('Пошук за назвою'), 'missing-file');
  expect(await screen.findByRole('heading', { name: 'Нічого не знайдено' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Скинути фільтри' }));
  expect(await screen.findByRole('article', { name: 'example-image.png' })).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Ще немає збережених файлів' }),
  ).not.toBeInTheDocument();
});
it('shows an empty library without inventing rows', async () => {
  mount(new FixtureAccountGateway('empty'));
  expect(
    await screen.findByRole('heading', { name: 'Ще немає збережених файлів' }),
  ).toBeInTheDocument();
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});
it('retains loaded rows after a next-page failure and exposes retry', async () => {
  mount(new FixtureAccountGateway('next-page-error'));
  const user = userEvent.setup();
  const files = await rows();
  await user.click(screen.getByRole('button', { name: 'Показати ще' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Перевірте з’єднання');
  expect(files.getAllByRole('article')).toHaveLength(3);
  await user.click(screen.getByRole('button', { name: 'Оновити список' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Показати ще' }));
  await waitFor(() => expect(files.getAllByRole('article')).toHaveLength(5));
});
it('shows details and clears a failed deletion message before another file confirmation', async () => {
  const gateway = new FixtureAccountGateway('delete-error');
  mount(gateway);
  const user = userEvent.setup();
  await rows();
  const first = within(screen.getByRole('article', { name: 'example-image.png' }));
  await user.click(first.getByRole('button', { name: 'Деталі' }));
  expect(within(screen.getByRole('dialog')).getByText('90 Б')).toBeInTheDocument();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрити' }));
  await user.click(first.getByRole('button', { name: 'Видалити' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Видалити файл' }),
  );
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
    'Перевірте з’єднання',
  );
  expect(screen.getByRole('article', { name: 'example-image.png' })).toBeInTheDocument();
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Скасувати' }));
  await user.click(
    within(screen.getByRole('article', { name: 'notes.pdf' })).getByRole('button', {
      name: 'Видалити',
    }),
  );
  expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Видалити файл' }),
  );
  expect(await screen.findByText('Файл видалено.')).toBeInTheDocument();
  expect(screen.queryByRole('article', { name: 'notes.pdf' })).not.toBeInTheDocument();
  expect(gateway.calls['delete-file']).toBe(2);
});
it('distinguishes retryable download errors from terminal denial and downloads independent Blob bytes', async () => {
  const gateway = new FixtureAccountGateway('success');
  const download = vi
    .spyOn(gateway, 'download')
    .mockRejectedValueOnce(new DataAccessError('network'))
    .mockResolvedValueOnce({
      blob: new Blob(['synthetic result'], { type: 'image/png' }),
      name: '../../safe.png',
    })
    .mockRejectedValueOnce(new DataAccessError('expired'));
  const create = vi.fn((blob: Blob) => `blob:owned-result-${blob.size}`);
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  mount(gateway);
  const user = userEvent.setup();
  await rows();
  const row = within(screen.getByRole('article', { name: 'example-image.png' }));
  await user.click(row.getByRole('button', { name: 'Завантажити' }));
  expect(await row.findByRole('alert')).toHaveTextContent('Перевірте з’єднання');
  await user.click(row.getByRole('button', { name: 'Завантажити' }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  await user.click(row.getByRole('button', { name: 'Завантажити' }));
  expect(
    await screen.findByText(/Файл більше недоступний для завантаження. Список/),
  ).toBeInTheDocument();
  expect(row.queryByRole('button', { name: 'Завантажити' })).not.toBeInTheDocument();
  expect(download).toHaveBeenCalledTimes(3);
});
it('synchronizes auto-save through account ↔ files navigation without deleting existing rows', async () => {
  const gateway = new FixtureAccountGateway('success');
  mount(gateway, '/account');
  const user = userEvent.setup();
  const toggle = await screen.findByRole('switch');
  await waitFor(() => expect(toggle).toBeEnabled());
  await user.click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  const nav = () => within(screen.getByRole('navigation', { name: 'Основна навігація' }));
  await user.click(nav().getByRole('link', { name: 'Мої файли' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Мої файли' })).toBeInTheDocument();
  await rows();
  expect(screen.getByRole('switch')).not.toBeChecked();
  await user.click(nav().getByRole('link', { name: 'Профіль' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Профіль' })).toBeInTheDocument();
  expect(await screen.findByRole('switch')).not.toBeChecked();
});
