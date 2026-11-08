import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FilesWorkspace } from './FilesWorkspace';
import type { FilesGateway, SavedFile } from '../lib/files-gateway';

let client: QueryClient;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function mount() {
  let files: SavedFile[] = ['first', 'second'].map((id) => ({
    id,
    name: `${id}.png`,
    format: 'png',
    sizeBytes: 10,
    createdAt: '2026-11-08T12:00:00Z',
  }));
  const removeFile = vi.fn((id: string) => {
    files = files.filter((file) => file.id !== id);
    return Promise.resolve();
  });
  const gateway: FilesGateway = {
    scope: 'owned',
    list: () => Promise.resolve({ files, nextCursor: null }),
    remove: removeFile,
    download: vi.fn(),
  };
  const view = render(
    <QueryClientProvider client={client}>
      <FilesWorkspace gateway={gateway} />
    </QueryClientProvider>,
  );
  await screen.findByRole('article', { name: 'first.png' });
  vi.useFakeTimers();
  return { ...view, gateway, removeFile };
}
async function remove(name: string) {
  fireEvent.click(
    within(screen.getByRole('article', { name })).getByRole('button', { name: 'Видалити' }),
  );
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Видалити файл' }),
    );
    await Promise.resolve();
  });
}
it('refreshes a single accessible notice after consecutive deletions and dismisses at four seconds', async () => {
  const { removeFile } = await mount();
  await remove('first.png');
  expect(screen.getByText('Файл видалено.')).toHaveAttribute('role', 'status');
  await act(() => vi.advanceTimersByTime(3000));
  await remove('second.png');
  expect(screen.getAllByText('Файл видалено.')).toHaveLength(1);
  await act(() => vi.advanceTimersByTime(3999));
  expect(screen.getByText('Файл видалено.')).toBeInTheDocument();
  await act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByText('Файл видалено.')).not.toBeInTheDocument();
  expect(removeFile).toHaveBeenCalledTimes(2);
});
it('clears timers on unmount and never carries the notice into another gateway scope', async () => {
  const { gateway, rerender, unmount } = await mount();
  await remove('first.png');
  const clear = vi.spyOn(window, 'clearTimeout');
  rerender(
    <QueryClientProvider client={client}>
      <FilesWorkspace gateway={{ ...gateway, scope: 'another' }} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText('Файл видалено.')).not.toBeInTheDocument();
  expect(clear).toHaveBeenCalled();
  rerender(
    <QueryClientProvider client={client}>
      <FilesWorkspace gateway={gateway} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText('Файл видалено.')).not.toBeInTheDocument();
  unmount();
  await act(() => vi.advanceTimersByTime(5000));
});

it('cancels an active dismissal timer when the workspace unmounts', async () => {
  const { unmount } = await mount();
  await remove('first.png');
  const clear = vi.spyOn(window, 'clearTimeout');
  unmount();
  expect(clear).toHaveBeenCalled();
  await act(() => vi.advanceTimersByTime(5000));
  expect(screen.queryByText('Файл видалено.')).not.toBeInTheDocument();
});
