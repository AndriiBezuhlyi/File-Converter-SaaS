import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { FilesWorkspace } from './FilesWorkspace';
import type { FilesGateway } from '../lib/files-gateway';

it('places an accessible pencil before the filename while keeping the other row actions', async () => {
  const name = 'Довга назва café.png';
  const gateway: FilesGateway = {
    scope: 'synthetic-owner',
    list: vi.fn().mockResolvedValue({
      files: [
        { id: 'synthetic', name, format: 'png', sizeBytes: 42, createdAt: '2026-11-13T10:00:00Z' },
      ],
      nextCursor: null,
    }),
    download: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <FilesWorkspace gateway={gateway} />
    </QueryClientProvider>,
  );
  try {
    const row = await screen.findByRole('article', { name });
    const pencil = within(row).getByRole('button', { name: 'Перейменувати' });
    const filename = within(row).getByRole('heading', { name });
    expect(pencil.parentElement).toBe(filename.parentElement);
    expect(pencil.nextElementSibling).toBe(filename);
    expect(pencil).toHaveAttribute('title', 'Перейменувати файл');
    expect(pencil.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    pencil.focus();
    expect(pencil).toHaveFocus();
    expect(
      within(row)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(['Перейменувати', 'Деталі', 'Завантажити', 'Видалити']);
  } finally {
    view.unmount();
    client.clear();
  }
});
