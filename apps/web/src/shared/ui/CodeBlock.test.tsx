import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

afterEach(() => vi.restoreAllMocks());

it('copies exact multiline code only on request and confirms success', async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const code =
    "curl 'https://api.example.com/api/v1/files' \\\n  --header 'X-API-Key: YOUR_API_KEY'";
  render(<CodeBlock label="Приклад запиту" code={code} />);
  expect(write).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: 'Код: Приклад запиту' })).toHaveAttribute(
    'tabindex',
    '0',
  );
  await user.click(screen.getByRole('button', { name: 'Копіювати: Приклад запиту' }));
  expect(write).toHaveBeenCalledExactlyOnceWith(code);
  expect(screen.getByRole('button', { name: 'Скопійовано: Приклад запиту' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('код скопійовано');
});

it('keeps code readable on clipboard denial and permits retry', async () => {
  const user = userEvent.setup();
  const write = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValue(new DOMException('Blocked', 'NotAllowedError'));
  render(<CodeBlock label="JSON" code={'{ "status": "queued" }'} />);
  await user.click(screen.getByRole('button', { name: 'Копіювати: JSON' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Виділіть і скопіюйте код вручну.');
  expect(screen.getByRole('region', { name: 'Код: JSON' })).toHaveTextContent('queued');
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  write.mockResolvedValue();
  await user.click(screen.getByRole('button', { name: 'Копіювати: JSON' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Скопійовано: JSON' })).toBeInTheDocument();
});
