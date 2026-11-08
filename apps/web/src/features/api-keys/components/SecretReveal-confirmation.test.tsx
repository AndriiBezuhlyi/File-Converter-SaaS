import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SecretReveal } from './SecretReveal';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('requires confirmation, preserves the exact secret on cancel/Escape, and restores focus', async () => {
  const hide = vi.fn();
  render(<SecretReveal secret="synthetic-only-secret" onHide={hide} />);
  const user = userEvent.setup();
  const opener = screen.getByRole('button', { name: 'Приховати назавжди' });
  await user.click(opener);
  expect(hide).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Скасувати' })).toHaveFocus();
  expect(screen.getByRole('dialog')).toHaveTextContent('Приховування не відкликає ключ');
  await user.click(screen.getByRole('button', { name: 'Скасувати' }));
  expect(opener).toHaveFocus();
  expect(screen.getByLabelText('Новий API-ключ')).toHaveValue('synthetic-only-secret');
  await user.click(opener);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(hide).not.toHaveBeenCalled();
  expect(opener).toHaveFocus();
  await user.click(opener);
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Приховати ключ' }),
  );
  expect(hide).toHaveBeenCalledTimes(1);
});
it('discards an open confirmation on unmount without invoking hide or retaining it for a new key', () => {
  const hide = vi.fn();
  const first = render(<SecretReveal secret="synthetic-first" onHide={hide} />);
  fireEvent.click(screen.getByRole('button', { name: 'Приховати назавжди' }));
  first.unmount();
  render(<SecretReveal secret="synthetic-second" onHide={hide} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Новий API-ключ')).toHaveValue('synthetic-second');
  expect(hide).not.toHaveBeenCalled();
});
