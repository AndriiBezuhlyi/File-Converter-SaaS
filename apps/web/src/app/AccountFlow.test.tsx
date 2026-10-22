import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { AutoSaveSetting } from '../features/account/components/AutoSaveSetting';
import { FixtureAccountGateway } from '../../test-fixtures/account-gateway';
import { DataAccessError } from '../shared/lib/data-access-error';

const clients: QueryClient[] = [];
beforeAll(async () => {
  await import('../pages/account/AccountPage');
});
function client() {
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(instance);
  return instance;
}
function mount(gateway: FixtureAccountGateway, path = '/account') {
  const instance = client();
  render(
    <QueryClientProvider client={instance}>
      <MemoryRouter initialEntries={[path]}>
        <App authGateway={gateway} accountGateway={gateway} apiKeyGateway={gateway} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return instance;
}
async function profileForm() {
  return screen.findByRole('form', { name: 'Особисті дані' });
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
  clients.splice(0).forEach((instance) => instance.clear());
  vi.restoreAllMocks();
});

it('does not read private resources for an anonymous session', async () => {
  const gateway = new FixtureAccountGateway('anonymous');
  mount(gateway);
  expect(await screen.findByRole('link', { name: 'Увійти до акаунту' })).toBeInTheDocument();
  expect(gateway.calls.profile).toBeUndefined();
  expect(gateway.calls.key).toBeUndefined();
  expect(gateway.calls.settings).toBeUndefined();
});

it('validates identity confirmation, preserves rejected data, and clears password on confirmed profile change', async () => {
  const gateway = new FixtureAccountGateway('success');
  const save = vi.spyOn(gateway, 'updateProfile');
  const instance = mount(gateway);
  const user = userEvent.setup();
  const form = within(await profileForm());
  await user.click(form.getByRole('button', { name: 'Зберегти дані' }));
  expect(await form.findByText('Введіть поточний пароль.')).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  await user.clear(form.getByLabelText('Ім’я'));
  await user.type(form.getByLabelText('Ім’я'), 'Нове ім’я');
  await user.type(form.getByLabelText('Поточний пароль', { exact: true }), 'wrong');
  await user.click(form.getByRole('button', { name: 'Зберегти дані' }));
  expect(await form.findByRole('alert')).toHaveTextContent('Перевірте поточний пароль');
  expect(form.getByLabelText('Ім’я')).toHaveValue('Нове ім’я');
  await user.clear(form.getByLabelText('Поточний пароль', { exact: true }));
  await user.type(form.getByLabelText('Поточний пароль', { exact: true }), 'synthetic-current');
  await user.click(form.getByRole('button', { name: 'Зберегти дані' }));
  expect(await form.findByRole('status')).toHaveTextContent('Особисті дані збережено.');
  expect(form.getByLabelText('Поточний пароль', { exact: true })).toHaveValue('');
  expect(
    JSON.stringify(
      instance
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain('synthetic-current');
});

it('acknowledges email verification without claiming the new email is already active', async () => {
  const gateway = new FixtureAccountGateway('success');
  mount(gateway);
  const user = userEvent.setup();
  const form = within(await profileForm());
  await user.clear(form.getByLabelText('Електронна пошта'));
  await user.type(form.getByLabelText('Електронна пошта'), 'new@example.test');
  await user.type(form.getByLabelText('Поточний пароль', { exact: true }), 'synthetic-current');
  await user.click(form.getByRole('button', { name: 'Зберегти дані' }));
  expect(
    await form.findByText('Перевірте пошту, щоб підтвердити зміну адреси.'),
  ).toBeInTheDocument();
  expect(form.getByLabelText('Електронна пошта')).toHaveValue('reader@example.test');
});

it('guards repeated profile submits while the first request is pending', async () => {
  const gateway = new FixtureAccountGateway('success');
  let finish: (() => void) | undefined;
  const save = vi.spyOn(gateway, 'updateProfile').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            profile: { displayName: 'Олена', email: 'reader@example.test' },
            verificationRequired: false,
          });
      }),
  );
  mount(gateway);
  const user = userEvent.setup();
  const form = await profileForm();
  await user.type(
    within(form).getByLabelText('Поточний пароль', { exact: true }),
    'synthetic-current',
  );
  fireEvent.submit(form);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  fireEvent.submit(form);
  expect(within(form).getByRole('button', { name: 'Зберігаємо…' })).toBeDisabled();
  await act(async () => {
    finish?.();
    await Promise.resolve();
  });
  expect(await within(form).findByText('Особисті дані збережено.')).toBeInTheDocument();
  expect(save).toHaveBeenCalledTimes(1);
});

it('checks new-password confirmation and preserves confirmed success through session read failure', async () => {
  const gateway = new FixtureAccountGateway('success');
  const change = vi.spyOn(gateway, 'changePassword');
  vi.spyOn(gateway, 'readSession')
    .mockResolvedValueOnce({ kind: 'authenticated', email: 'reader@example.test' })
    .mockRejectedValue(new DataAccessError('network'));
  mount(gateway);
  const user = userEvent.setup();
  const form = within(await screen.findByRole('form', { name: 'Зміна пароля' }));
  await user.type(form.getByLabelText('Поточний пароль', { exact: true }), 'synthetic-current');
  await user.type(form.getByLabelText('Новий пароль', { exact: true }), 'synthetic-new');
  await user.type(form.getByLabelText('Повторіть новий пароль', { exact: true }), 'different');
  await user.click(form.getByRole('button', { name: 'Змінити пароль' }));
  expect(await form.findByText('Паролі не збігаються.')).toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
  await user.clear(form.getByLabelText('Повторіть новий пароль', { exact: true }));
  await user.type(form.getByLabelText('Повторіть новий пароль', { exact: true }), 'synthetic-new');
  await user.click(form.getByRole('button', { name: 'Змінити пароль' }));
  expect(await screen.findByText('Пароль змінено. Увійдіть із новим паролем.')).toBeInTheDocument();
  expect(change).toHaveBeenCalledTimes(1);
});

it('shares one pessimistic auto-save value and disables simultaneous writes across mounted views', async () => {
  const gateway = new FixtureAccountGateway('success');
  let resolve: ((value: { autoSave: boolean }) => void) | undefined;
  const save = vi.spyOn(gateway, 'setAutoSave').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(
    <QueryClientProvider client={client()}>
      <AutoSaveSetting gateway={gateway} />
      <AutoSaveSetting gateway={gateway} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const switches = screen.getAllByRole('switch');
  await waitFor(() => expect(switches[0]).toBeEnabled());
  await user.click(switches[0]!);
  expect(switches[0]).toBeChecked();
  await waitFor(() => expect(switches[1]).toBeDisabled());
  await user.click(switches[1]!);
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve?.({ autoSave: false });
    await Promise.resolve();
  });
  await waitFor(() => expect(switches[0]).not.toBeChecked());
  expect(switches[1]).not.toBeChecked();
});

it('keeps the confirmed auto-save value when its update fails', async () => {
  const gateway = new FixtureAccountGateway('settings-error');
  mount(gateway);
  const user = userEvent.setup();
  const toggle = await screen.findByRole('switch');
  await waitFor(() => expect(toggle).toBeEnabled());
  await user.click(toggle);
  expect(await screen.findByText(/Зміна не підтверджена/)).toBeInTheDocument();
  expect(toggle).toBeChecked();
});

it('shows a created key only once and keeps secrets out of both caches, with clipboard fallback', async () => {
  const gateway = new FixtureAccountGateway('no-key');
  const instance = mount(gateway);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Створити ключ' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Поточний пароль', { exact: true }), 'synthetic-current');
  await user.click(dialog.getByRole('button', { name: 'Створити ключ' }));
  expect(await screen.findByLabelText('Новий API-ключ')).toHaveValue('fixture_key_public_demo_1');
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Denied'));
  await user.click(screen.getByRole('button', { name: 'Копіювати ключ' }));
  expect(await screen.findByText(/Виділіть ключ і скопіюйте вручну/)).toBeInTheDocument();
  const cached = JSON.stringify({
    queries: instance
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
    mutations: instance
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state),
  });
  expect(cached).not.toContain('fixture_key_public_demo_1');
  expect(cached).not.toContain('synthetic-current');
  await user.click(screen.getByRole('button', { name: 'Приховати назавжди' }));
  expect(screen.queryByLabelText('Новий API-ключ')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Маскований API-ключ')).toHaveTextContent('demo_1••••••••');
  expect(screen.queryByRole('button', { name: 'Копіювати ключ' })).not.toBeInTheDocument();
});

it('does not rotate on cancellation and blocks replay after an ambiguous rotation', async () => {
  const gateway = new FixtureAccountGateway('key-unknown');
  mount(gateway);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Перевипустити ключ' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Скасувати' }));
  expect(gateway.calls['rotate-key']).toBeUndefined();
  await user.click(screen.getByRole('button', { name: 'Перевипустити ключ' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Поточний пароль', { exact: true }), 'synthetic-current');
  await user.click(dialog.getByRole('button', { name: 'Перевипустити ключ' }));
  expect(await screen.findByText(/Ключ міг бути створений або замінений/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Перевипустити ключ' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Оновити дані ключа' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Перевипустити ключ' })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Маскований API-ключ')).toHaveTextContent('demo_1');
  expect(gateway.calls['rotate-key']).toBe(1);
});
