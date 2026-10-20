import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FileSelector } from './FileSelector';

function drop(files: File[]) {
  return fireEvent.drop(screen.getByRole('group', { name: 'Область вибору файлу' }), {
    dataTransfer: { files, types: ['Files'], items: [] },
  });
}

describe('local file selection', () => {
  it('provides a keyboard-accessible picker and waits for a file before offering targets', async () => {
    const user = userEvent.setup();
    render(<FileSelector />);
    expect(screen.getByLabelText('Конвертувати у')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Конвертувати' })).toBeDisabled();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Вибрати файл' })).toHaveFocus();
  });

  it.each([
    ['photo.jpg', 'PNG'],
    ['photo.JPEG', 'PNG'],
    ['image.png', 'JPG'],
    ['document.DOCX', 'PDF'],
  ])('offers only the supported target for %s', async (name, target) => {
    const user = userEvent.setup();
    render(<FileSelector />);
    await user.upload(screen.getByLabelText('Файл для конвертації'), new File(['synthetic'], name));
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByLabelText('Конвертувати у')).toHaveValue(target.toLowerCase());
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: target })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Конвертувати' })).toBeDisabled();
  });

  it('keeps a valid selection when a rejected replacement is chosen, then resets for the same file', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<FileSelector />);
    const input = screen.getByLabelText('Файл для конвертації');
    const file = new File(['synthetic'], 'photo.jpg');
    await user.upload(input, file);
    await user.upload(input, new File(['synthetic'], 'document.pdf'));
    expect(screen.getByRole('alert')).toHaveTextContent('Цей формат не підтримується.');
    expect(screen.getByRole('alert')).toHaveTextContent('Попередній вибір збережено.');
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByLabelText('Конвертувати у')).toHaveValue('png');
    await user.click(screen.getByRole('button', { name: 'Прибрати файл' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Конвертувати у')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Вибрати файл' })).toHaveFocus();
    await user.upload(input, file);
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
  });

  it('accepts a dropped file, clears the highlight, and rejects batches without losing the selection', () => {
    render(<FileSelector />);
    const zone = screen.getByRole('group', { name: 'Область вибору файлу' });
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    expect(zone).toHaveAttribute('data-dragging', 'true');
    const file = new File(['synthetic'], 'report.docx');
    drop([file]);
    expect(zone).toHaveAttribute('data-dragging', 'false');
    expect(screen.getByLabelText('Конвертувати у')).toHaveValue('pdf');
    drop([file, new File(['x'], 'other.png')]);
    expect(screen.getByRole('alert')).toHaveTextContent('Виберіть один файл за раз.');
    expect(screen.getByText('report.docx')).toBeInTheDocument();
  });

  it('rejects a directory and preserves selection when the native picker is cancelled', async () => {
    const user = userEvent.setup();
    render(<FileSelector />);
    const input = screen.getByLabelText('Файл для конвертації');
    await user.upload(input, new File(['x'], 'image.png'));
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.getByText('image.png')).toBeInTheDocument();
    fireEvent.drop(screen.getByRole('group', { name: 'Область вибору файлу' }), {
      dataTransfer: {
        files: [],
        types: ['Files'],
        items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }],
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Виберіть один файл, а не папку.');
    expect(screen.getByText('image.png')).toBeInTheDocument();
  });

  it('prevents navigation when a file is dropped outside the workspace', () => {
    render(<FileSelector />);
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } });
    fireEvent(document.body, event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByLabelText('Конвертувати у')).toBeDisabled();
  });
});
