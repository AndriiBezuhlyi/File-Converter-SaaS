import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { ConverterWorkspace } from './ConverterWorkspace';
import type { ConversionGateway, SubmissionOutcome } from '../lib/conversion-gateway';

it.each([
  'invalid-file',
  'animated-gif',
  'animated-webp',
  'animated-avif',
  'rate-limit',
  'unavailable',
] as const)(
  'clears only file-specific rejection %s on a new valid selection or target',
  async (reason) => {
    const gateway: ConversionGateway = {
      scope: reason,
      readAccess: () => Promise.resolve({ kind: 'account', jobId: null }),
      submit: () => Promise.resolve({ kind: 'rejected', reason } satisfies SubmissionOutcome),
      readJob: () => Promise.reject(new Error('No job expected')),
      download: () => Promise.reject(new Error('No download expected')),
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ConverterWorkspace gateway={gateway} requestedId={null} onJobId={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Файл для конвертації'),
      new File(['synthetic'], 'source.jpg'),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Конвертувати' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Конвертувати' }));
    const message = (await screen.findByRole('alert')).textContent;
    const fileSpecific = !['rate-limit', 'unavailable'].includes(reason);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Конвертувати у' }), 'webp');
    if (fileSpecific) expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    else expect(screen.getByRole('alert')).toHaveTextContent(message);
    await user.click(screen.getByRole('button', { name: 'Конвертувати' }));
    await screen.findByRole('alert');
    await user.upload(
      screen.getByLabelText('Файл для конвертації'),
      new File(['replacement'], 'новий файл.png'),
    );
    if (fileSpecific) expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    else expect(screen.getByRole('alert')).toHaveTextContent(message);
    view.unmount();
    client.clear();
  },
);
