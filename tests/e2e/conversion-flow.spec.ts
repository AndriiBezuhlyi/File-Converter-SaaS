import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174' });

async function open(page: Page, scenario = 'success') {
  await page.goto(`/test-fixtures/converter/?scenario=${scenario}`);
  await expect(page).toHaveTitle('Конвертер файлів — converter');
  await expect(page.getByRole('note')).toContainText('без реальної конвертації');
}

async function start(page: Page) {
  await page.getByLabel('Файл для конвертації').setInputFiles({
    name: 'source.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('synthetic upload bytes, not the output PNG'),
  });
  const submit = page.getByRole('button', { name: 'Конвертувати', exact: true });
  await expect(submit).toBeEnabled();
  await submit.dblclick();
}

async function counters(page: Page, pattern: RegExp) {
  const output = page.getByLabel('Лічильники тестового стенда');
  await output.getByRole('button').click();
  await expect(output).toContainText(pattern);
}

test('measured upload, queue, processing, real Blob download, and next-guest authentication', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await start(page);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '48');
  await expect(page.getByText('Файл передано. Очікуємо підтвердження прийняття.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Файл у черзі' })).toBeVisible();
  await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  await expect(page.getByRole('heading', { name: 'Конвертуємо файл' })).toBeVisible();
  await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible();
  await expect(page).toHaveURL(/conversion=fixture_job/);
  await counters(page, /POST: 1;/);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('example.png');
  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const bytes = await readFile(filePath);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.toString()).not.toContain('synthetic upload bytes');
  await download.delete();
  const next = page.getByRole('button', { name: 'Конвертувати інший файл' });
  await expect(next).toBeEnabled();
  await next.click();
  const dialog = page.getByRole('dialog', { name: 'Продовжіть після входу' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Увійти' })).toBeFocused();
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(next).toBeFocused();
  await expect(page.getByRole('button', { name: 'Завантажити', exact: true })).toBeVisible();
  await counters(page, /POST: 1;/);
  expect(errors).toEqual([]);
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
});

test('terminal failure releases the test server reservation and retains a usable selection flow', async ({
  page,
}) => {
  await open(page, 'failed');
  await start(page);
  await expect(page.getByRole('heading', { name: 'Не вдалося конвертувати' })).toBeVisible({
    timeout: 10_000,
  });
  const next = page.getByRole('button', { name: 'Вибрати інший файл' });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByText('1 файл безкоштовно без реєстрації')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Вибрати файл', exact: true })).toBeEnabled();
  await counters(page, /POST: 1;/);
});

test('connection errors recover by known ID and never trigger another upload', async ({ page }) => {
  await open(page, 'connection');
  await start(page);
  await expect(page.getByRole('heading', { name: 'Відновлюємо зв’язок' })).toBeVisible();
  await page.getByRole('button', { name: 'Перевірити ще раз' }).click();
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible({
    timeout: 10_000,
  });
  await counters(page, /POST: 1;/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Відновлюємо зв’язок' })).toBeVisible();
  await page.getByRole('button', { name: 'Перевірити ще раз' }).click();
  await expect(page.getByRole('heading', { name: 'Файл у черзі' })).toBeVisible();
  await counters(page, /POST: 0;/);
  await expect(page).toHaveURL(/conversion=fixture_job/);
});

test('an ambiguous response blocks replay, while unknown upload totals show no percentage', async ({
  page,
}) => {
  await open(page, 'unknown');
  await start(page);
  await expect(page.getByRole('heading', { name: 'Відновлюємо зв’язок' })).toBeVisible();
  await page.getByRole('button', { name: 'Перевірити ще раз' }).click();
  await expect(page.getByText('Повторно файл не надсилаємо.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Конвертувати', exact: true })).not.toBeVisible();
  await counters(page, /POST: 1;/);
  await open(page, 'unmeasured');
  await start(page);
  await expect(page.getByRole('heading', { name: 'Завантажуємо файл' })).toBeVisible();
  await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  await expect(page.getByText('Передаємо файл…')).toBeVisible();
});

test('expired results stay complete without a download action or renewed guest allowance', async ({
  page,
}) => {
  await open(page, 'expired');
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible();
  await expect(page.getByText(/Результат більше недоступний/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Завантажити', exact: true })).not.toBeVisible();
  await counters(page, /POST: 0;/);
  await page.getByRole('button', { name: 'Конвертувати інший файл' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('download failure is retryable without changing the completed conversion', async ({
  page,
}) => {
  await page.goto('/test-fixtures/converter/?scenario=download-error&conversion=fixture_job');
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Конвертація завершена');
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
  await (await download).delete();
  await counters(page, /POST: 0;.*download: 2/);
});

test('completed results and the native auth dialog reflow on mobile and desktop', async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1366, 1505]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1045 });
    await open(page, 'consumed');
    await expect(page.getByRole('button', { name: 'Завантажити', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Конвертувати інший файл' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  }
});
