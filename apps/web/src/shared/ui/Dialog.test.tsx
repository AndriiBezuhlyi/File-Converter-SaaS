import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

const prototype = HTMLDialogElement.prototype;
const initialShow = Object.getOwnPropertyDescriptor(prototype, 'showModal');
const initialClose = Object.getOwnPropertyDescriptor(prototype, 'close');
beforeEach(() => {
  // jsdom does not implement the native modal top layer or Escape-to-cancel behavior.
  Object.defineProperties(prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    },
  });
});
afterEach(() => {
  cleanup();
  for (const [name, original] of [
    ['showModal', initialShow],
    ['close', initialClose],
  ] as const) {
    if (original) Object.defineProperty(prototype, name, original);
    else Reflect.deleteProperty(prototype, name);
  }
});

it('labels the dialog, starts at the safe action, traps Tab and restores opener focus', async () => {
  render(<button type="button">Open confirmation</button>);
  const opener = screen.getByRole('button', { name: 'Open confirmation' });
  opener.focus();
  const close = vi.fn();
  const { unmount } = render(
    <Dialog title="Delete saved file?" onClose={close}>
      <button type="button">Delete file</button>
      <button type="button" data-initial-focus>
        Cancel
      </button>
    </Dialog>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Delete saved file?' });
  expect(dialog).toHaveAttribute('open');
  const user = userEvent.setup();
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Закрити діалог' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  const cancel = new Event('cancel', { cancelable: true });
  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  unmount();
  expect(opener).toHaveFocus();
});

it('blocks cancellation while a destructive action is pending, then allows it after completion', async () => {
  const close = vi.fn();
  const { rerender } = render(<Dialog title="Delete saved file?" onClose={close} pending />);
  const user = userEvent.setup();
  const dialog = screen.getByRole('dialog');
  const cancel = new Event('cancel', { cancelable: true });
  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  const button = screen.getByRole('button', { name: 'Закрити діалог' });
  expect(button).toBeDisabled();
  await user.click(button);
  expect(close).not.toHaveBeenCalled();
  rerender(<Dialog title="Delete saved file?" onClose={close} />);
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledTimes(1);
});
