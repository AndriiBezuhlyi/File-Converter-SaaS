import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174' });

interface SyntheticFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const validJpg: SyntheticFile = {
  name: 'replacement.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from('owned synthetic replacement'),
};

async function open(page: Page, scenario: 'success' | 'rejected-once' = 'success') {
  await page.goto(`/test-fixtures/converter/?scenario=${scenario}`);
  await expect(page).toHaveTitle('Конвертер файлів — converter');
  await expect(page.getByRole('note')).toContainText('без реальної конвертації');
}

async function chooseThroughInterface(page: Page, file: SyntheticFile) {
  const chooserEvent = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^(Вибрати|Змінити) файл$/ }).click();
  await (await chooserEvent).setFiles(file);
}

async function expectValidReplacement(page: Page) {
  await chooseThroughInterface(page, validJpg);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(validJpg.name, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Конвертувати у')).toHaveValue('png');
  await expect(page.getByRole('button', { name: 'Конвертувати', exact: true })).toBeEnabled();
}

async function expectCounters(page: Page, pattern: RegExp) {
  const counters = page.getByLabel('Лічильники тестового стенда');
  await counters.getByRole('button').click();
  await expect(counters).toContainText(pattern);
}

test('unsupported format shows a clear error and accepts another file', async ({ page }) => {
  await open(page);
  await chooseThroughInterface(page, {
    name: 'unsupported.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a supported source'),
  });

  await expect(page.getByRole('alert')).toContainText(
    'Цей формат не підтримується. Виберіть JPG, PNG або DOCX.',
  );
  await expect(page.getByLabel('Файл для конвертації')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Конвертувати', exact: true })).toBeDisabled();
  await expectCounters(page, /POST: 0;/);
  await expectValidReplacement(page);
});

test('oversized file shows the 20 MB limit and accepts another file', async ({ page }) => {
  await open(page);
  await chooseThroughInterface(page, {
    name: 'too-large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(20_000_001, 1),
  });

  await expect(page.getByRole('alert')).toContainText(
    'Файл завеликий. Максимальний розмір — 20 МБ.',
  );
  await expect(page.getByLabel('Файл для конвертації')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Конвертувати', exact: true })).toBeDisabled();
  await expectCounters(page, /POST: 0;/);
  await expectValidReplacement(page);
});

test('corrupted file is rejected and a replacement conversion succeeds', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await open(page, 'rejected-once');
  await chooseThroughInterface(page, {
    name: 'corrupted.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('this is not JPEG content'),
  });
  await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText(
    'Сервер відхилив файл. Виберіть інший файл або формат.',
  );
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expectCounters(page, /POST: 1;/);

  await chooseThroughInterface(page, validJpg);
  await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible({
    timeout: 10_000,
  });
  await expectCounters(page, /POST: 2;/);
  expect(runtimeErrors).toEqual([]);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
