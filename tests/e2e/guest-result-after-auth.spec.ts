import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174' });

async function openResult(page: Page, scenario: 'consumed' | 'expired') {
  await page.goto(`/test-fixtures/converter/?scenario=${scenario}`);
  await expect(page).toHaveTitle('Конвертер файлів — Clarity Converter');
  await expect(page.getByRole('note')).toContainText('без реальної конвертації');
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible();
  await expect(page.getByText('Гостьовий результат не зберігається в акаунті.')).toBeVisible();
}

async function signInFromResult(page: Page) {
  await page.getByRole('button', { name: 'Конвертувати інший файл' }).click();
  const dialog = page.getByRole('dialog', { name: 'Продовжіть після входу' });
  await expect(dialog).toContainText('Безкоштовну конвертацію вже використано');
  await dialog.getByRole('link', { name: 'Увійти' }).click();
  await page.getByLabel('Електронна пошта').fill('reader@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Увійти', exact: true }).click();
  await expect(page).toHaveURL(/conversion=fixture_job/);
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible();
}

async function expectCounters(page: Page, pattern: RegExp) {
  const counters = page.getByLabel('Лічильники тестового стенда');
  await counters.getByRole('button').click();
  await expect(counters).toContainText(pattern);
}

test('available guest result stays downloadable and unsaved after sign-in', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await openResult(page, 'consumed');
  await signInFromResult(page);

  await expect(page.getByText('Гостьовий результат не зберігається в акаунті.')).toBeVisible();
  await expect(page.getByText('Збережено в «Мої файли»')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('example.png');
  const path = await download.path();
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await download.delete();
  await expectCounters(page, /POST: 0;.*download: 1/);
  expect(runtimeErrors).toEqual([]);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('sign-in does not revive or transfer an expired guest result', async ({ page }) => {
  await openResult(page, 'expired');
  await expect(page.getByText(/Результат більше недоступний/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Завантажити', exact: true })).toHaveCount(0);
  await signInFromResult(page);

  await expect(page.getByText(/Результат більше недоступний/)).toBeVisible();
  await expect(page.getByText('Гостьовий результат не зберігається в акаунті.')).toBeVisible();
  await expect(page.getByText('Збережено в «Мої файли»')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Завантажити', exact: true })).toHaveCount(0);
  await expectCounters(page, /POST: 0;.*download: 0/);
});
