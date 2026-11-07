import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { AxiosAdapter } from 'axios';
import { describe, expect, it } from 'vitest';
import { createHttpClient } from '../../../shared/api/http-client';
import { createSessionClient } from '../../../shared/api/session-client';
import { ConverterWorkspace } from '../components/ConverterWorkspace';
import { createConversionGateway } from './conversion-http-gateway';
import { ConversionRequestError } from './conversion-gateway';

function fixture(status: number, code: string) {
  const requests: string[] = [];
  const adapter: AxiosAdapter = (config) => {
    requests.push(`${config.method} ${config.url}`);
    const bootstrap = config.url === 'guest-session';
    return Promise.resolve({
      config,
      status: bootstrap ? status : 200,
      statusText: '',
      headers: {},
      data: bootstrap
        ? { error: { code } }
        : config.url === 'auth/session'
          ? { kind: 'anonymous' }
          : { csrfToken: 'synthetic-csrf' },
    });
  };
  return {
    requests,
    gateway: createConversionGateway(
      createSessionClient(createHttpClient({ adapter })),
      'anonymous',
    ),
  };
}

describe('invalid guest credential recovery', () => {
  it.each([
    [401, 'GUEST_CREDENTIAL_INVALID', 'guest-session-invalid'],
    [401, 'AUTH_REQUIRED', 'forbidden'],
    [403, 'CSRF_INVALID', 'forbidden'],
    [503, 'DEPENDENCY_UNAVAILABLE', 'network'],
  ] as const)(
    'distinguishes %s %s without replacing the credential',
    async (status, code, kind) => {
      const { gateway, requests } = fixture(status, code);
      await expect(gateway.readAccess(new AbortController().signal)).rejects.toEqual(
        new ConversionRequestError(kind),
      );
      expect(requests).toEqual(['get auth/session', 'get auth/csrf', 'post guest-session']);
    },
  );

  it.each([
    [401, 'GUEST_CREDENTIAL_INVALID', true],
    [503, 'DEPENDENCY_UNAVAILABLE', false],
  ] as const)(
    'offers appropriate recovery for %s without uploading a selected file',
    async (status, code, invalid) => {
      const { gateway, requests } = fixture(status, code);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <ConverterWorkspace gateway={gateway} requestedId={null} onJobId={() => {}} />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      try {
        if (invalid) {
          expect(await screen.findByText(/Гостьова сесія недійсна/)).toBeVisible();
          expect(screen.getByRole('link', { name: 'Увійти' })).toHaveAttribute(
            'href',
            '/login?returnTo=%2F',
          );
          expect(screen.getByRole('link', { name: 'Створити акаунт' })).toBeVisible();
          expect(screen.queryByRole('button', { name: 'Перевірити доступ ще раз' })).toBeNull();
        } else {
          expect(
            await screen.findByRole('button', { name: 'Перевірити доступ ще раз' }),
          ).toBeVisible();
          expect(screen.queryByRole('link', { name: 'Увійти' })).toBeNull();
        }
        const user = userEvent.setup();
        await user.upload(
          screen.getByLabelText('Файл для конвертації'),
          new File(['synthetic'], 'owned.jpg'),
        );
        const convert = screen.getByRole('button', { name: 'Конвертувати' });
        expect(convert).toBeDisabled();
        await user.click(convert);
        expect(requests).toEqual(['get auth/session', 'get auth/csrf', 'post guest-session']);
      } finally {
        view.unmount();
        client.clear();
      }
    },
  );
});
