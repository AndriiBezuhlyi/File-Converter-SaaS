import { useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ConverterDraftProvider } from '../components/ConverterDraftProvider';
import { ConverterWorkspace } from '../components/ConverterWorkspace';
import { useConverterDraft, type ConverterDraft } from './converter-draft-context';
import {
  ConversionRequestError,
  type ConversionGateway,
  type ConversionJob,
  type SubmissionOutcome,
  type ConversionAccess,
} from './conversion-gateway';
import { useConversionFlow } from './use-conversion-flow';
import { AuthContext } from '../../auth/lib/auth-context';
import type { AuthGateway, AuthSession } from '../../auth/lib/auth-gateway';

afterEach(() => vi.useRealTimers());
const file = new File(['synthetic'], 'lifecycle.jpg', { type: 'image/jpeg' });
const completed: ConversionJob = {
  id: 'job',
  sourceName: file.name,
  sourceFormat: 'jpg',
  targetFormat: 'png',
  status: 'completed',
  result: {
    name: 'result.png',
    format: 'png',
    sizeBytes: 10,
    owner: 'account',
    retention: { kind: 'saved' },
    availability: 'available',
  },
};

it('clears the draft and sends no upload if another tab changed the account before admission', async () => {
  const submit = vi.fn<ConversionGateway['submit']>();
  const gateway: ConversionGateway = {
    scope: 'identity-check',
    readAccess: () => Promise.resolve({ kind: 'account', jobId: null }),
    submit,
    readJob: vi.fn(),
    download: vi.fn(),
  };
  const session: AuthSession = { kind: 'authenticated', email: 'first@example.test' };
  const changed: AuthSession = { kind: 'authenticated', email: 'second@example.test' };
  const auth: AuthGateway = {
    scope: 'identity-auth',
    readSession: () => Promise.resolve(changed),
    register: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resendVerification: vi.fn(),
    verifyEmail: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  };
  const client = new QueryClient();
  const hook = renderHook(
    () => ({ draft: useConverterDraft()!, flow: useConversionFlow(gateway, null, () => {}) }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <AuthContext
            value={{
              gateway: auth,
              session,
              status: 'ready',
              refreshSession: () => Promise.resolve(changed),
            }}
          >
            <ConverterDraftProvider>{children}</ConverterDraftProvider>
          </AuthContext>
        </QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(hook.result.current.flow.access.isSuccess).toBe(true));
  const selected = { file, sourceFormat: 'jpg', targetFormat: 'png' } as const;
  act(() => hook.result.current.draft.setSelection(selected));
  act(() => hook.result.current.flow.submit(selected));
  await waitFor(() => expect(hook.result.current.flow.upload.isError).toBe(true));
  expect(hook.result.current.draft.selection).toBeNull();
  expect(client.getQueryData(['auth', auth.scope, 'session'])).toEqual(changed);
  expect(submit).not.toHaveBeenCalled();
  hook.unmount();
  client.clear();
});

it('never sends file bytes after navigation interrupts the admission check', async () => {
  let resolveAccess!: (access: ConversionAccess) => void;
  let reads = 0;
  const submit = vi.fn<ConversionGateway['submit']>();
  const gateway: ConversionGateway = {
    scope: 'navigation-check',
    readAccess: () =>
      ++reads === 1
        ? Promise.resolve({ kind: 'account', jobId: null })
        : new Promise((resolve) => {
            resolveAccess = resolve;
          }),
    submit,
    readJob: vi.fn(),
    download: vi.fn(),
  };
  const client = new QueryClient();
  const hook = renderHook(
    () => ({ draft: useConverterDraft()!, flow: useConversionFlow(gateway, null, () => {}) }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <ConverterDraftProvider>{children}</ConverterDraftProvider>
        </QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(hook.result.current.flow.access.isSuccess).toBe(true));
  const selected = { file, sourceFormat: 'jpg', targetFormat: 'png' } as const;
  act(() => hook.result.current.draft.setSelection(selected));
  act(() => hook.result.current.flow.submit(selected));
  await waitFor(() => expect(reads).toBe(2));
  hook.unmount();
  await act(async () => {
    resolveAccess({ kind: 'account', jobId: null });
    await Promise.resolve();
  });
  expect(submit).not.toHaveBeenCalled();
  client.clear();
});

function setup(gateway: ConversionGateway) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } },
  });
  let draft: ConverterDraft | null = null;
  function Workspace() {
    const [id, setId] = useState<string | null>(null);
    draft = useConverterDraft();
    return <ConverterWorkspace gateway={gateway} requestedId={id} onJobId={setId} />;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConverterDraftProvider>
          <Workspace />
        </ConverterDraftProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, view, draft: () => draft! };
}

it('idle cleanup releases the draft without aborting the upload or losing its accepted result', async () => {
  let resolveUpload!: (outcome: SubmissionOutcome) => void;
  let signal: AbortSignal | undefined;
  const submit = vi.fn<ConversionGateway['submit']>((_selection, _progress, abort) => {
    signal = abort;
    return new Promise<SubmissionOutcome>((resolve) => {
      resolveUpload = resolve;
    });
  });
  const gateway: ConversionGateway = {
    scope: 'idle-active',
    readAccess: () => Promise.resolve({ kind: 'account', jobId: null }),
    submit,
    readJob: () => Promise.resolve(completed),
    download: () => Promise.reject(new Error('Not requested')),
  };
  const app = setup(gateway);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Конвертувати' })).toHaveAttribute('disabled'),
  );
  fireEvent.change(screen.getByLabelText('Файл для конвертації'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Конвертувати' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Конвертувати' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(app.client.getMutationCache().getAll()[0]!.state.variables).toBeUndefined();
  vi.useFakeTimers();
  act(() => {
    vi.advanceTimersByTime(30 * 60_000);
    window.dispatchEvent(new Event('focus'));
  });
  expect(app.draft().selection).toBeNull();
  expect(signal?.aborted).toBe(false);
  expect(screen.getByRole('region', { name: 'Стан конвертації' })).toHaveTextContent(
    'Час зберігання вибору минув',
  );
  await act(async () => {
    resolveUpload({ kind: 'accepted', job: completed });
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByRole('heading', { name: 'Файл готовий' })).toBeVisible();
  expect(submit).toHaveBeenCalledTimes(1);
  app.view.unmount();
  app.client.clear();
});

it('retries a recoverable rejection with the same File, clears on success and preserves focus', async () => {
  let attempts = 0;
  const submitted: File[] = [];
  const gateway: ConversionGateway = {
    scope: 'retry-draft',
    readAccess: () => Promise.resolve({ kind: 'account', jobId: null }),
    submit: (selection) => {
      submitted.push(selection.file);
      return Promise.resolve(
        ++attempts === 1
          ? { kind: 'rejected', reason: 'unavailable' }
          : { kind: 'accepted', job: completed },
      );
    },
    readJob: () => Promise.resolve(completed),
    download: () => Promise.reject(new Error('Not requested')),
  };
  const app = setup(gateway);
  fireEvent.change(screen.getByLabelText('Файл для конвертації'), { target: { files: [file] } });
  const convert = () => screen.getByRole('button', { name: 'Конвертувати' });
  await waitFor(() => expect(convert()).toBeEnabled());
  convert().focus();
  fireEvent.click(convert());
  await screen.findByText(/Сервіс тимчасово недоступний/);
  expect(app.draft().selection?.file).toBe(file);
  await waitFor(() => expect(convert()).toBeEnabled());
  fireEvent.click(convert());
  await screen.findByRole('heading', { name: 'Файл готовий' });
  await waitFor(() => expect(app.draft().selection).toBeNull());
  expect(submitted).toEqual([file, file]);
  expect(screen.getByRole('heading', { name: 'Файл готовий' })).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Конвертувати' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Конвертувати інший файл' }));
  expect(screen.getByRole('button', { name: 'Вибрати файл' })).toHaveFocus();
  app.view.unmount();
  app.client.clear();
});

it('clears an invalid guest draft without resubmission', async () => {
  const submit = vi.fn<ConversionGateway['submit']>();
  const gateway: ConversionGateway = {
    scope: 'expired-guest',
    readAccess: () => Promise.reject(new ConversionRequestError('guest-session-invalid')),
    submit,
    readJob: vi.fn(),
    download: vi.fn(),
  };
  const app = setup(gateway);
  act(() => app.draft().setSelection({ file, sourceFormat: 'jpg', targetFormat: 'png' }));
  await screen.findByText(/Гостьова сесія недійсна/);
  await waitFor(() => expect(app.draft().selection).toBeNull());
  expect(submit).not.toHaveBeenCalled();
  app.view.unmount();
  app.client.clear();
});
