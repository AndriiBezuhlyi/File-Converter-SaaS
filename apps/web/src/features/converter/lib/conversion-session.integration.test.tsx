import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { AuthContext } from '../../auth/lib/auth-context';
import { ConverterWorkspace } from '../components/ConverterWorkspace';
import type { ConversionGateway } from './conversion-gateway';

it('locks file selection until session hydration settles so identity remounts cannot discard a chosen file', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const gateway: ConversionGateway = {
    scope: 'synthetic',
    readAccess: () => Promise.resolve({ kind: 'account', jobId: null }),
    submit: () => Promise.resolve({ kind: 'unknown' }),
    readJob: () => Promise.reject(new Error('No job selected.')),
    download: () => Promise.reject(new Error('No result selected.')),
  };
  function view(status: 'pending' | 'ready') {
    return (
      <QueryClientProvider client={client}>
        <AuthContext
          value={{
            gateway: undefined,
            session: null,
            status,
            refreshSession: () => Promise.resolve({ kind: 'anonymous' }),
          }}
        >
          <ConverterWorkspace gateway={gateway} requestedId={null} onJobId={() => {}} />
        </AuthContext>
      </QueryClientProvider>
    );
  }
  const mounted = render(view('pending'));
  expect(screen.getByRole('button', { name: 'Вибрати файл' })).toBeDisabled();
  expect(screen.getByLabelText('Файл для конвертації')).toBeDisabled();
  mounted.rerender(view('ready'));
  expect(screen.getByRole('button', { name: 'Вибрати файл' })).toBeEnabled();
  mounted.unmount();
  client.clear();
});
