import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { AuthContext } from '../../features/auth/lib/auth-context';
import { AppHeader } from './AppHeader';

it('closes on Escape with focus restore and on route selection; retains active route highlighting', async () => {
  render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{
          gateway: undefined,
          status: 'ready',
          session: { kind: 'authenticated', email: 'synthetic@example.test' },
          refreshSession: () => Promise.resolve({ kind: 'anonymous' }),
        }}
      >
        <AppHeader />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: 'Відкрити меню' });
  await user.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  const nav = screen.getByRole('navigation');
  within(nav).getByRole('link', { name: 'Мої файли' }).focus();
  await user.keyboard('{Escape}');
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute('aria-expanded', 'false');
  await user.click(button);
  await user.click(within(nav).getByRole('link', { name: 'Мої файли' }));
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(within(nav).getByRole('link', { name: 'Мої файли' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
