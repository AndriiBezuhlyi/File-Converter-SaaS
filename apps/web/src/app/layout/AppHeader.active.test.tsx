import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { AuthContext } from '../../features/auth/lib/auth-context';
import { AppHeader } from './AppHeader';

it.each([
  ['/', 'Конвертер'],
  ['/?source=test#how-it-works', 'Конвертер'],
  ['/api-docs/#errors', 'API'],
  ['/api-docs/nested', 'API'],
  ['/files/?page=2#saved', 'Мої файли'],
  ['/files/nested', 'Мої файли'],
  ['/account/?tab=settings#profile', 'Профіль'],
  ['/account/nested', 'Профіль'],
  ['/login', undefined],
])('marks only the relevant authenticated route at %s', (path, expected) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider
        value={{
          gateway: undefined,
          status: 'ready',
          session: { kind: 'authenticated', email: 'reader@example.test' },
          refreshSession: () => Promise.resolve({ kind: 'anonymous' }),
        }}
      >
        <AppHeader />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  const links = within(screen.getByRole('navigation')).getAllByRole('link');
  expect(
    links
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent),
  ).toEqual(expected ? [expected] : []);
  expect(new Set(links.map((link) => link.className.replace(/\s*\bactive\b/, ''))).size).toBe(1);
});
