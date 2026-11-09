import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthContext } from '../../auth/lib/auth-context';
import type { AuthGateway, AuthSession } from '../../auth/lib/auth-gateway';
import { ConverterDraftProvider } from './ConverterDraftProvider';
import { FileSelector } from './FileSelector';
import { useConverterDraft } from '../lib/converter-draft-context';
import type { FileSelection } from '../lib/file-selection';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../auth/components/AuthProvider';
import { useAuth } from '../../auth/lib/auth-context';

const selection: FileSelection = {
  file: new File(['synthetic'], 'draft.jpg', { type: 'image/jpeg' }),
  sourceFormat: 'jpg',
  targetFormat: 'png',
};
afterEach(() => vi.useRealTimers());

it('updates the expiry boundary on a same-session background refresh without losing the File', async () => {
  const session: AuthSession = { kind: 'authenticated', email: 'owned@example.test' };
  let deadline = Date.now() + 60_000;
  const gateway: AuthGateway = {
    scope: 'refresh',
    get sessionExpiresAt() {
      return deadline;
    },
    readSession: () => Promise.resolve(session),
    register: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resendVerification: vi.fn(),
    verifyEmail: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  };
  const client = new QueryClient();
  const hook = renderHook(() => ({ draft: useConverterDraft()!, auth: useAuth() }), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <AuthProvider gateway={gateway}>
          <ConverterDraftProvider>{children}</ConverterDraftProvider>
        </AuthProvider>
      </QueryClientProvider>
    ),
  });
  await waitFor(() => expect(hook.result.current.auth.status).toBe('ready'));
  act(() => hook.result.current.draft.setSelection(selection));
  deadline += 60_000;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['auth', gateway.scope, 'session'] });
  });
  await waitFor(() => expect(hook.result.current.auth.sessionExpiresAt).toBe(deadline));
  expect(hook.result.current.draft.selection?.file).toBe(selection.file);
  hook.unmount();
  client.clear();
});

it('does not remount the converter when initial anonymous session hydration completes', () => {
  let session: AuthSession | null = null;
  let status: 'pending' | 'ready' = 'pending';
  const hook = renderHook(useConverterDraft, {
    wrapper: ({ children }) => (
      <AuthContext
        value={{
          session,
          status,
          gateway: undefined,
          refreshSession: () => Promise.resolve({ kind: 'anonymous' }),
        }}
      >
        <ConverterDraftProvider>{children}</ConverterDraftProvider>
      </AuthContext>
    ),
  });
  const clear = hook.result.current!.clear;
  session = { kind: 'anonymous' };
  status = 'ready';
  hook.rerender();
  expect(hook.result.current!.clear).toBe(clear);
});

it('retains the exact File and target through route unmount and Back, then releases on removal', async () => {
  const user = userEvent.setup();
  let selected: FileSelection | undefined;
  render(
    <MemoryRouter>
      <ConverterDraftProvider>
        <Link to="/away">Away</Link>
        <Link to="/">Home</Link>
        <Routes>
          <Route
            path="/"
            element={
              <FileSelector
                onConvert={(value) => {
                  selected = value;
                }}
              />
            }
          />
          <Route path="/away" element={<p>Other page</p>} />
        </Routes>
      </ConverterDraftProvider>
    </MemoryRouter>,
  );
  await user.upload(screen.getByLabelText('Файл для конвертації'), selection.file);
  await user.click(screen.getByRole('link', { name: 'Away' }));
  expect(screen.queryByLabelText('Файл для конвертації')).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Home' }));
  expect(screen.getByRole('combobox')).toHaveValue('png');
  await user.click(screen.getByRole('button', { name: 'Конвертувати' }));
  expect(selected?.file).toBe(selection.file);
  await user.click(screen.getByRole('button', { name: 'Прибрати файл' }));
  expect(screen.queryByText('draft.jpg')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Вибрати файл' })).toHaveFocus();
});

it('keeps same-account refreshes and clears guest login, account switch, logout and invalid sessions', () => {
  let session: AuthSession = { kind: 'anonymous' };
  let status: 'ready' | 'error' = 'ready';
  const hook = renderHook(useConverterDraft, {
    wrapper: ({ children }) => (
      <AuthContext
        value={{
          session,
          status,
          gateway: undefined,
          refreshSession: () => Promise.resolve(session),
        }}
      >
        <ConverterDraftProvider>{children}</ConverterDraftProvider>
      </AuthContext>
    ),
  });
  act(() => hook.result.current!.setSelection(selection));
  session = { kind: 'authenticated', email: 'first@example.test' };
  hook.rerender();
  expect(hook.result.current!.selection).toBeNull();
  act(() => hook.result.current!.setSelection(selection));
  session = { ...session };
  hook.rerender();
  expect(hook.result.current!.selection?.file).toBe(selection.file);
  session = { kind: 'authenticated', email: 'second@example.test' };
  hook.rerender();
  expect(hook.result.current!.selection).toBeNull();
  act(() => hook.result.current!.setSelection(selection));
  session = { kind: 'anonymous' };
  hook.rerender();
  expect(hook.result.current!.selection).toBeNull();
  act(() => hook.result.current!.setSelection(selection));
  status = 'error';
  hook.rerender();
  expect(hook.result.current!.selection).toBeNull();
});

it('expires after 30 idle minutes, renews only on interaction, and rejects a stale event after background expiry', () => {
  vi.useFakeTimers();
  const hook = renderHook(useConverterDraft, { wrapper: ConverterDraftProvider });
  act(() => hook.result.current!.setSelection(selection));
  act(() => {
    vi.advanceTimersByTime(29 * 60_000);
  });
  act(() => hook.result.current!.touch());
  act(() => {
    vi.advanceTimersByTime(29 * 60_000);
  });
  expect(hook.result.current!.selection).toBe(selection);
  // A suspended background timer must not let the first returning click extend an expired draft.
  vi.setSystemTime(Date.now() + 2 * 60_000);
  act(() => hook.result.current!.touch());
  expect(hook.result.current!.selection).toBeNull();
  expect(hook.result.current!.message).toContain('Виберіть файл знову');
  expect(hook.result.current!.isCurrent(selection)).toBe(false);
  act(() => hook.result.current!.setSelection(selection));
  act(() => {
    vi.advanceTimersByTime(30 * 60_000);
  });
  expect(hook.result.current!.selection).toBeNull();
  hook.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('honors the server session expiry even while converter activity renews idle retention', () => {
  vi.useFakeTimers();
  const session: AuthSession = { kind: 'authenticated', email: 'owned@example.test' };
  const gateway = { scope: 'test', sessionExpiresAt: Date.now() + 60_000 } as AuthGateway;
  const hook = renderHook(useConverterDraft, {
    wrapper: ({ children }) => (
      <AuthContext
        value={{
          session,
          status: 'ready',
          gateway,
          refreshSession: () => Promise.resolve(session),
        }}
      >
        <ConverterDraftProvider>{children}</ConverterDraftProvider>
      </AuthContext>
    ),
  });
  act(() => hook.result.current!.setSelection(selection));
  act(() => {
    vi.advanceTimersByTime(50_000);
  });
  act(() => hook.result.current!.touch());
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(hook.result.current!.selection).toBeNull();
});

it('clears only the completed job draft, never a replacement selected while an older job finishes', () => {
  const hook = renderHook(useConverterDraft, { wrapper: ConverterDraftProvider });
  act(() => {
    hook.result.current!.setSelection(selection);
    hook.result.current!.bindJob(selection, 'old');
  });
  const replacement = { ...selection, file: new File(['other'], 'other.jpg') };
  act(() => hook.result.current!.setSelection(replacement));
  act(() => {
    hook.result.current!.bindJob(selection, 'old');
    hook.result.current!.completeJob('old');
  });
  expect(hook.result.current!.selection).toBe(replacement);
  act(() => {
    hook.result.current!.bindJob(replacement, 'new');
    hook.result.current!.completeJob('new');
  });
  expect(hook.result.current!.selection).toBeNull();
});
