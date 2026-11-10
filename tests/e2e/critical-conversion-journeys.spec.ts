import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174' });

const sourceBytes = Buffer.from('owned synthetic upload bytes, not a converted result');

const conversions = [
  {
    label: 'JPG → PNG',
    sourceName: 'guest-source.jpg',
    sourceMime: 'image/jpeg',
    target: 'png',
    resultName: 'example.png',
    signature: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  },
  {
    label: 'PNG → JPG',
    sourceName: 'guest-source.png',
    sourceMime: 'image/png',
    target: 'jpg',
    resultName: 'example.jpg',
    signature: Buffer.from([255, 216, 255]),
  },
  {
    label: 'DOCX → PDF',
    sourceName: 'guest-source.docx',
    sourceMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    target: 'pdf',
    resultName: 'example.pdf',
    signature: Buffer.from('%PDF-', 'ascii'),
  },
] as const;

type ConversionCase = (typeof conversions)[number];
type ConversionInput = {
  sourceName: string;
  sourceMime: string;
  target: ConversionCase['target'];
};

async function open(page: Page, scenario: 'success' | 'failed-once' = 'success') {
  await page.goto(`/test-fixtures/converter/?scenario=${scenario}`);
  await expect(page).toHaveTitle('Конвертер файлів — Flux Converter');
  await expect(page.getByRole('note')).toContainText('без реальної конвертації');
}

async function selectFile(page: Page, conversion: ConversionInput) {
  await page.getByLabel('Файл для конвертації').setInputFiles({
    name: conversion.sourceName,
    mimeType: conversion.sourceMime,
    buffer: sourceBytes,
  });
  await expect(page.getByText(conversion.sourceName, { exact: true })).toBeVisible();
  const format = page.getByLabel('Конвертувати у');
  await expect(format).toBeEnabled();
  await format.selectOption(conversion.target);
  await expect(format).toHaveValue(conversion.target);
}

async function convert(page: Page) {
  const submit = page.getByRole('button', { name: 'Конвертувати', exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
}

async function expectCompleted(page: Page) {
  await expect(page.getByRole('heading', { name: 'Файл у черзі' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Конвертуємо файл' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible({
    timeout: 10_000,
  });
}

async function expectCounters(page: Page, pattern: RegExp) {
  const counters = page.getByLabel('Лічильники тестового стенда');
  await counters.getByRole('button').click();
  await expect(counters).toContainText(pattern);
}

for (const conversion of conversions) {
  test(`free guest converts and downloads ${conversion.label}`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await open(page);
    await expect(page.getByText('1 файл безкоштовно без реєстрації')).toBeVisible();
    await selectFile(page, conversion);
    await convert(page);
    await expectCompleted(page);
    await expect(page).toHaveURL(/conversion=fixture_job/);
    await expect(page.getByText(conversion.resultName, { exact: true })).toBeVisible();

    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(conversion.resultName);
    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path);
    expect(bytes.subarray(0, conversion.signature.length).equals(conversion.signature)).toBe(true);
    expect(bytes.equals(sourceBytes)).toBe(false);
    if (conversion.target === 'jpg') expect([...bytes.subarray(-2)]).toEqual([255, 217]);
    if (conversion.target === 'pdf') expect(bytes.toString('ascii')).toContain('%%EOF');
    await download.delete();

    await expectCounters(page, /POST: 1;.*download: 1/);
    expect(runtimeErrors).toEqual([]);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  });
}

test('guest signs in after the free conversion and can submit another file', async ({ page }) => {
  await open(page);
  await selectFile(page, { ...conversions[0], sourceName: 'free-source.jpg' });
  await convert(page);
  await expectCompleted(page);

  await page.getByRole('button', { name: 'Конвертувати інший файл' }).click();
  const dialog = page.getByRole('dialog', { name: 'Продовжіть після входу' });
  await expect(dialog).toContainText('Безкоштовну конвертацію вже використано');
  await dialog.getByRole('link', { name: 'Увійти' }).click();

  await expect(page.getByRole('heading', { name: 'Увійти' })).toBeVisible();
  await page.getByLabel('Електронна пошта').fill('reader@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Увійти', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible();
  await expect(page.getByText('Гостьовий результат не зберігається в акаунті.')).toBeVisible();
  await page.getByRole('button', { name: 'Конвертувати інший файл' }).click();
  await expect(page.getByRole('button', { name: 'Вибрати файл', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Конвертувати у')).toBeDisabled();
  await expect(
    page.getByText('1 файл безкоштовно без реєстрації', { exact: true }),
  ).not.toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await selectFile(page, { ...conversions[0], sourceName: 'account-source.jpg' });
  await convert(page);
  await expectCompleted(page);
  await expect(page.getByText('Збережено в «Мої файли»')).toBeVisible();
  await expectCounters(page, /POST: 2;/);
});

test('failed conversion leaves processing, shows an error and succeeds on manual retry', async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));

  await open(page, 'failed-once');
  await selectFile(page, { ...conversions[0], sourceName: 'broken-source.jpg' });
  await convert(page);
  await expect(page.getByRole('heading', { name: 'Конвертуємо файл' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Не вдалося конвертувати' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('alert')).toContainText(
    'Файл пошкоджений або не підтримує цю конвертацію.',
  );
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Конвертуємо файл' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Вибрати інший файл' }).click();
  await expect(page.getByText('1 файл безкоштовно без реєстрації')).toBeVisible();
  await selectFile(page, { ...conversions[0], sourceName: 'retry-source.jpg' });
  await convert(page);
  await expectCompleted(page);
  await expectCounters(page, /POST: 2;/);
  expect(runtimeErrors).toEqual([]);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

// TODO(item 17): repeat these journeys against the real API, worker, object storage and
// authentication service when those implementations are available. These tests intentionally
// verify browser orchestration with controlled gateway responses and synthetic owned files.
