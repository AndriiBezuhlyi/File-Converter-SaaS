import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AutoSaveSetting } from '../components/AutoSaveSetting';
import type { AccountSettings, SettingsGateway } from './account-gateway';
import { DataAccessError } from '../../../shared/lib/data-access-error';

const clients: QueryClient[] = [];
function mount(gateway: SettingsGateway) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <AutoSaveSetting gateway={gateway} />
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

it('reconciles a committed setting after its response is lost without replaying the write', async () => {
  let saved = { autoSave: true };
  const gateway = {
    scope: 'settings-test',
    readSettings: vi.fn(() => Promise.resolve(saved)),
    setAutoSave: vi.fn((autoSave: boolean) => {
      saved = { autoSave };
      return Promise.reject(new DataAccessError('network'));
    }),
  } satisfies SettingsGateway;
  const client = mount(gateway);
  const toggle = screen.getByRole('switch');
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.setup().click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(toggle).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Зміна не підтверджена');
  expect(client.getQueryData(['settings', gateway.scope])).toEqual({ autoSave: false });
  expect(gateway.setAutoSave).toHaveBeenCalledExactlyOnceWith(false);
  expect(gateway.readSettings).toHaveBeenCalledTimes(2);
});

it('cancels an older settings read so it cannot overwrite a confirmed change', async () => {
  let finishRead: (value: AccountSettings) => void = () => {};
  let signal: AbortSignal | undefined;
  const gateway = {
    scope: 'settings-test',
    readSettings: vi
      .fn<SettingsGateway['readSettings']>()
      .mockResolvedValueOnce({ autoSave: true })
      .mockImplementationOnce((readSignal) => {
        signal = readSignal;
        return new Promise((resolve) => {
          finishRead = resolve;
        });
      }),
    setAutoSave: vi.fn((autoSave: boolean) => Promise.resolve({ autoSave })),
  } satisfies SettingsGateway;
  const client = mount(gateway);
  const toggle = screen.getByRole('switch');
  await waitFor(() => expect(toggle).toBeEnabled());
  let refetch: Promise<void> | undefined;
  act(() => {
    refetch = client.refetchQueries({ queryKey: ['settings', gateway.scope] });
  });
  expect(signal?.aborted).toBe(false);
  await userEvent.setup().click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    finishRead({ autoSave: true });
    await refetch;
  });
  expect(toggle).not.toBeChecked();
  expect(client.getQueryData(['settings', gateway.scope])).toEqual({ autoSave: false });
  expect(gateway.setAutoSave).toHaveBeenCalledExactlyOnceWith(false);
});
