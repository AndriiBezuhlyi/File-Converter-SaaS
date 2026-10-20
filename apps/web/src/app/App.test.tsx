import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function renderRoute(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('application navigation', () => {
  it('renders the homepage without presenting unavailable conversion controls', () => {
    renderRoute();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Інший формат. Той самий файл.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вибрати файл' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Конвертувати' })).toBeDisabled();
  });

  it('updates the document title and moves focus to content on navigation', async () => {
    const user = userEvent.setup();
    renderRoute();
    await user.click(screen.getByRole('link', { name: 'Увійти' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Увійти' })).toBeInTheDocument();
    expect(document.title).toBe('Увійти — converter');
    expect(screen.getByRole('main')).toHaveFocus();
    expect(screen.queryByLabelText(/пароль/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'До конвертера' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Інший формат. Той самий файл.' }),
    ).toBeInTheDocument();
  });

  it('opens the navigation and returns focus to its trigger on Escape', async () => {
    const user = userEvent.setup();
    renderRoute();
    await user.click(screen.getByRole('button', { name: 'Відкрити меню' }));
    expect(screen.getByRole('button', { name: 'Закрити меню' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    screen.getByRole('link', { name: 'Увійти' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Відкрити меню' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Відкрити меню' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('provides a recovery link for unknown routes', async () => {
    const user = userEvent.setup();
    renderRoute('/missing-page');
    expect(screen.getByRole('heading', { name: 'Сторінку не знайдено' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'До конвертера' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Інший формат. Той самий файл.' }),
    ).toBeInTheDocument();
  });
});
