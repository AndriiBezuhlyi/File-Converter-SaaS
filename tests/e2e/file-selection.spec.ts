import { expect, test, type Page } from '@playwright/test';

interface DroppedFile {
  name: string;
  size: number;
}

// These fixtures exercise local selection, not engine/content validation.
async function dropFiles(page: Page, files: DroppedFile[]) {
  const dataTransfer = await page.evaluateHandle((entries) => {
    const transfer = new DataTransfer();
    for (const entry of entries)
      transfer.items.add(new File([new Uint8Array(entry.size)], entry.name));
    return transfer;
  }, files);
  const zone = page.getByRole('group', { name: 'Область вибору файлу' });
  await zone.dispatchEvent('dragenter', { dataTransfer });
  await expect(zone).toHaveAttribute('data-dragging', 'true');
  await zone.dispatchEvent('drop', { dataTransfer });
  await expect(zone).toHaveAttribute('data-dragging', 'false');
  await dataTransfer.dispose();
}

test('keyboard picker selects, replaces, and removes a file without sending it to the API', async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.method());
  });
  await page.goto('/');
  await expect(page.getByLabel('Конвертувати у')).toBeDisabled();
  await page.getByRole('button', { name: 'Вибрати файл' }).focus();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from('synthetic'),
  });
  await expect(page.getByText('sample.png', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Конвертувати у')).toHaveValue('jpg');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByLabel('Файл для конвертації').setInputFiles({
    name: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('synthetic'),
  });
  await expect(page.getByLabel('Конвертувати у')).toHaveValue('pdf');
  await expect(page.getByText('sample.png', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Конвертувати', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Прибрати файл' }).click();
  await expect(page.getByRole('button', { name: 'Вибрати файл' })).toBeFocused();
  await expect(page.getByLabel('Конвертувати у')).toBeDisabled();
  await page.getByLabel('Файл для конвертації').setInputFiles({
    name: 'report.docx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('synthetic'),
  });
  await expect(page.getByText('report.docx', { exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test('real DataTransfer accepts the size boundary and rejects oversized, unsupported, empty, and multiple files', async ({
  page,
}) => {
  await page.goto('/');
  await dropFiles(page, [{ name: 'photo.JPEG', size: 20_000_000 }]);
  await expect(page.getByText('photo.JPEG', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Конвертувати у')).toHaveValue('png');
  await dropFiles(page, [{ name: 'too-large.png', size: 20_000_001 }]);
  await expect(page.getByRole('alert')).toContainText('Максимальний розмір — 20 МБ.');
  await expect(page.getByText('photo.JPEG', { exact: true })).toBeVisible();
  await dropFiles(page, [{ name: 'unsupported.pdf', size: 8 }]);
  await expect(page.getByRole('alert')).toContainText('Цей формат не підтримується.');
  await dropFiles(page, [{ name: 'empty.jpg', size: 0 }]);
  await expect(page.getByRole('alert')).toContainText('Файл порожній.');
  await dropFiles(page, [
    { name: 'one.png', size: 1 },
    { name: 'two.png', size: 1 },
  ]);
  await expect(page.getByRole('alert')).toContainText('Виберіть один файл за раз.');
  await dropFiles(page, [{ name: 'replacement.png', size: 8 }]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Конвертувати у')).toHaveValue('jpg');
});

test('long filenames and error states reflow on mobile, and outside drops do not navigate', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 768 });
  await page.goto('/');
  const name = 'довга-назва-документа-'.repeat(9) + '.docx';
  await dropFiles(page, [{ name, size: 1024 }]);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await dropFiles(page, [{ name: 'invalid.pdf', size: 1 }]);
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const prevented = await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'outside.png'));
    const event = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page).toHaveURL('/');
  await expect(page.getByText(name, { exact: true })).toBeVisible();
});
