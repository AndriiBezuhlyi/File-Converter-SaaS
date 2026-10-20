import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { Field } from './Field';

it('associates its label, hint, and validation message with the editable input', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <Field label="Електронна пошта" type="email" hint="Вкажіть свою адресу." />,
  );
  const input = screen.getByRole('textbox', { name: 'Електронна пошта' });
  await user.type(input, 'invalid');
  expect(input).toHaveValue('invalid');
  expect(input).toHaveAccessibleDescription('Вкажіть свою адресу.');
  expect(input).not.toHaveAttribute('aria-invalid', 'true');
  rerender(
    <Field
      label="Електронна пошта"
      type="email"
      hint="Вкажіть свою адресу."
      error="Перевірте адресу пошти."
    />,
  );
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('Вкажіть свою адресу. Перевірте адресу пошти.');
  expect(screen.getByRole('alert')).toHaveTextContent('Перевірте адресу пошти.');
});
