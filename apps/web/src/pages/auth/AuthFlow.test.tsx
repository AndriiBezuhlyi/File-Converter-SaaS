import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthPage, type AuthPageKind } from './AuthPage';
import { AuthProvider } from '../../features/auth/components/AuthProvider';
import { SessionActions } from '../../features/auth/components/SessionActions';
import {
  AuthRequestError,
  type AuthGateway,
  type AuthSession,
} from '../../features/auth/lib/auth-gateway';

const clients: QueryClient[] = [];
function fixture() {
  let session: AuthSession = { kind: 'anonymous' };
  const gateway = {
    scope: 'unit-auth',
    readSession: vi.fn<AuthGateway['readSession']>(() => Promise.resolve(session)),
    register: vi.fn<AuthGateway['register']>(() => Promise.resolve()),
    signIn: vi.fn<AuthGateway['signIn']>(() => {
      session = { kind: 'authenticated', email: 'reader@example.test' };
      return Promise.resolve('signed-in');
    }),
    signOut: vi.fn<AuthGateway['signOut']>(() => {
      session = { kind: 'anonymous' };
      return Promise.resolve();
    }),
    verifyEmail: vi.fn<AuthGateway['verifyEmail']>(() => Promise.resolve()),
    resendVerification: vi.fn<AuthGateway['resendVerification']>(() => Promise.resolve()),
    requestPasswordReset: vi.fn<AuthGateway['requestPasswordReset']>(() => Promise.resolve()),
    resetPassword: vi.fn<AuthGateway['resetPassword']>(() => Promise.resolve()),
  };
  return gateway;
}
function Location() {
  const location = useLocation();
  return (
    <div aria-label="Current route">
      {location.pathname}
      {location.search}
    </div>
  );
}
function mount(path: string, gateway?: AuthGateway) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider gateway={gateway}>
          <SessionActions />
          <Routes>
            {(
              [
                'login',
                'register',
                'verify-email',
                'forgot-password',
                'reset-password',
              ] as AuthPageKind[]
            ).map((kind) => (
              <Route key={kind} path={`/${kind}`} element={<AuthPage key={kind} kind={kind} />} />
            ))}
            <Route path="/" element={<h1>Converter</h1>} />
            <Route path="/files" element={<h1>Files</h1>} />
          </Routes>
          <Location />
          <Link to="/verify-email?token=fixture-token">Open verification link</Link>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

async function credentials(mode: 'login' | 'register' | 'reset' = 'login') {
  const user = userEvent.setup();
  await waitFor(() =>
    expect(
      screen.getByLabelText(mode === 'reset' ? 'Новий пароль' : 'Пароль', {
        exact: true,
        selector: 'input',
      }),
    ).toBeEnabled(),
  );
  if (mode !== 'reset')
    await user.type(screen.getByLabelText('Електронна пошта'), 'reader@example.test');
  await user.type(
    screen.getByLabelText(mode === 'reset' ? 'Новий пароль' : 'Пароль', {
      exact: true,
      selector: 'input',
    }),
    ' password ',
  );
  if (mode !== 'login') await user.type(screen.getByLabelText('Повторіть пароль'), ' password ');
  return user;
}

it('validates and focuses invalid fields without sending production credentials', async () => {
  mount('/login');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Увійти' }));
  expect(await screen.findByText('Вкажіть коректну електронну пошту.')).toBeInTheDocument();
  expect(screen.getByLabelText('Електронна пошта')).toHaveFocus();
  await user.type(screen.getByLabelText('Електронна пошта'), 'reader@example.test');
  await user.type(screen.getByLabelText('Пароль', { exact: true }), 'synthetic-password');
  await user.click(screen.getByRole('button', { name: 'Показати: пароль' }));
  expect(screen.getByLabelText('Пароль', { exact: true })).toHaveAttribute('type', 'text');
  await user.click(screen.getByRole('button', { name: 'Увійти' }));
  expect(
    await screen.findByText('Авторизацію ще не підключено. Дані нікуди не надіслано.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/login');
});

it('blocks mismatched registration and forwards validated values without password transformation', async () => {
  const gateway = fixture();
  mount('/register', gateway);
  await waitFor(() => expect(screen.getByLabelText('Електронна пошта')).toBeEnabled());
  const user = await credentials('register');
  await user.clear(screen.getByLabelText('Повторіть пароль'));
  await user.type(screen.getByLabelText('Повторіть пароль'), 'different');
  await user.click(screen.getByRole('button', { name: 'Створити акаунт' }));
  expect(await screen.findByText('Паролі не збігаються.')).toBeInTheDocument();
  expect(gateway.register).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Повторіть пароль'));
  await user.type(screen.getByLabelText('Повторіть пароль'), ' password ');
  await user.click(screen.getByRole('button', { name: 'Створити акаунт' }));
  expect(await screen.findByRole('heading', { name: 'Підтвердження пошти' })).toBeInTheDocument();
  expect(gateway.register).toHaveBeenCalledWith({
    email: 'reader@example.test',
    password: ' password ',
  });
});

it('guards pending sign-in, refreshes session, follows a safe return target, and keeps secrets out of caches', async () => {
  const gateway = fixture();
  let finish: (value: 'signed-in') => void = () => {};
  gateway.signIn.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  gateway.readSession
    .mockResolvedValueOnce({ kind: 'anonymous' })
    .mockResolvedValue({ kind: 'authenticated', email: 'reader@example.test' });
  const client = mount('/login?returnTo=%2F%3Fconversion%3Djob_1', gateway);
  client.setQueryData(['files'], ['private-old-account']);
  await waitFor(() => expect(screen.getByLabelText('Електронна пошта')).toBeEnabled());
  const user = await credentials();
  fireEvent.submit(screen.getByRole('form', { name: 'Увійти' }));
  await waitFor(() => expect(gateway.signIn).toHaveBeenCalledTimes(1));
  fireEvent.submit(screen.getByRole('form', { name: 'Увійти' }));
  expect(screen.getByLabelText('Пароль', { exact: true })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Зачекайте…' }));
  finish('signed-in');
  expect(await screen.findByRole('heading', { name: 'Converter' })).toBeInTheDocument();
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/?conversion=job_1');
  expect(gateway.signIn).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(['files'])).toBeUndefined();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain(' password ');
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it('shows generic sign-in failure and permits an explicit retry', async () => {
  const gateway = fixture();
  gateway.signIn.mockRejectedValueOnce(new AuthRequestError('invalid-credentials'));
  mount('/login?returnTo=https%3A%2F%2Fevil.invalid', gateway);
  await waitFor(() => expect(screen.getByLabelText('Електронна пошта')).toBeEnabled());
  const user = await credentials();
  await user.click(screen.getByRole('button', { name: 'Увійти' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Перевірте пошту та пароль.');
  await user.click(screen.getByRole('button', { name: 'Увійти' }));
  expect(await screen.findByRole('heading', { name: 'Converter' })).toBeInTheDocument();
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/');
});

it('uses the same recovery acknowledgement for any well-formed email', async () => {
  const gateway = fixture();
  mount('/forgot-password', gateway);
  const user = userEvent.setup();
  for (const email of ['reader@example.test', 'absent@example.test']) {
    await user.clear(screen.getByLabelText('Електронна пошта'));
    await user.type(screen.getByLabelText('Електронна пошта'), email);
    await user.click(screen.getByRole('button', { name: 'Надіслати посилання' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Якщо акаунт існує, лист із посиланням надійде на пошту.',
    );
  }
});

it('scrubs verification tokens, requires an explicit action, and does not sign in on verification', async () => {
  const gateway = fixture();
  mount('/verify-email?token=fixture-token', gateway);
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/verify-email');
  expect(screen.getByLabelText('Current route')).not.toHaveTextContent('token');
  expect(gateway.verifyEmail).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Підтвердити пошту' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Пошту підтверджено.');
  expect(gateway.verifyEmail).toHaveBeenCalledWith('fixture-token');
  expect(gateway.signIn).not.toHaveBeenCalled();
});

it('provides recovery after an invalid verification link', async () => {
  const gateway = fixture();
  gateway.verifyEmail.mockRejectedValueOnce(new AuthRequestError('invalid-token'));
  mount('/verify-email?token=expired-token', gateway);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Підтвердити пошту' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Посилання недійсне');
  expect(screen.getByRole('button', { name: 'Надіслати лист повторно' })).toBeEnabled();
  await userEvent.setup().click(screen.getByRole('link', { name: 'До входу' }));
});

it('does not expose reset fields without a link credential', () => {
  const gateway = fixture();
  mount('/reset-password', gateway);
  expect(screen.queryByLabelText('Новий пароль', { selector: 'input' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Запросити нове посилання' })).toBeInTheDocument();
  expect(gateway.resetPassword).not.toHaveBeenCalled();
});

it('scrubs an encoded token key and preserves the credential only for its action', async () => {
  const gateway = fixture();
  mount('/verify-email?%74oken=fixture-token', gateway);
  await waitFor(() =>
    expect(screen.getByLabelText('Current route')).not.toHaveTextContent('token'),
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Підтвердити пошту' }));
  expect(gateway.verifyEmail).toHaveBeenCalledWith('fixture-token');
});

it('captures a new link on an already mounted verification route and resets its terminal view', async () => {
  const gateway = fixture();
  mount('/verify-email', gateway);
  const user = userEvent.setup();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await user.click(screen.getByRole('link', { name: 'Open verification link' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current route')).not.toHaveTextContent('token'),
    );
    await user.click(screen.getByRole('button', { name: 'Підтвердити пошту' }));
    expect(await screen.findByText(/Пошту підтверджено/)).toBeInTheDocument();
    expect(gateway.verifyEmail).toHaveBeenCalledTimes(attempt);
  }
});

it('keeps a confirmed password change successful when session synchronization fails', async () => {
  const gateway = fixture();
  gateway.readSession
    .mockResolvedValueOnce({ kind: 'anonymous' })
    .mockRejectedValue(new AuthRequestError('network'));
  mount('/reset-password?token=fixture-token', gateway);
  await waitFor(() =>
    expect(screen.getByLabelText('Новий пароль', { selector: 'input' })).toBeEnabled(),
  );
  const user = await credentials('reset');
  await user.click(screen.getByRole('button', { name: 'Зберегти пароль' }));
  expect(await screen.findByText(/Пароль змінено/)).toBeInTheDocument();
  expect(await screen.findByText('Не вдалося перевірити вхід.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Зберегти пароль' })).not.toBeInTheDocument();
  expect(gateway.resetPassword).toHaveBeenCalledTimes(1);
});

it('resets from an in-memory link, clears password fields, and leaves the user signed out', async () => {
  const gateway = fixture();
  mount('/reset-password?token=fixture-token', gateway);
  const user = await credentials('reset');
  await user.click(screen.getByRole('button', { name: 'Зберегти пароль' }));
  expect(await screen.findByText(/Пароль змінено/)).toBeInTheDocument();
  expect(gateway.resetPassword).toHaveBeenCalledWith('fixture-token', ' password ');
  expect(screen.queryByLabelText('Новий пароль', { selector: 'input' })).not.toBeInTheDocument();
  expect(gateway.signIn).not.toHaveBeenCalled();
});

it('keeps authenticated controls after failed logout, then clears private cache after confirmation', async () => {
  const gateway = fixture();
  gateway.readSession
    .mockResolvedValueOnce({ kind: 'authenticated', email: 'reader@example.test' })
    .mockResolvedValue({ kind: 'anonymous' });
  gateway.signOut.mockRejectedValueOnce(new AuthRequestError('network'));
  const client = mount('/files', gateway);
  client.setQueryData(['files'], ['private']);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Вийти' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Перевірте з’єднання');
  expect(client.getQueryData(['files'])).toEqual(['private']);
  await user.click(screen.getByRole('button', { name: 'Вийти' }));
  expect(await screen.findByRole('heading', { name: 'Увійти' })).toBeInTheDocument();
  expect(client.getQueryData(['files'])).toBeUndefined();
});
