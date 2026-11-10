import { expect, test } from '@playwright/test';

test('preview and fixture servers keep unmocked API requests local', async ({ request }) => {
  for (const port of [4173, 4174]) {
    // Read-only probe remains harmless even if the proxy isolation regresses.
    const response = await request.get(`http://127.0.0.1:${port}/api/v1/health/live`);
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'E2E_UNMOCKED_REQUEST', message: 'Missing test fixture.' },
    });
    expect(response.headers()['set-cookie']).toBeUndefined();
  }
});

for (const width of [320, 390, 768, 1366]) {
  test(`keyboard file selection and responsive layout at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:4174/test-fixtures/converter/');
    await expect(page).toHaveTitle('Конвертер файлів — Flux Converter');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    const picker = page.getByRole('button', { name: 'Вибрати файл', exact: true });
    await picker.focus();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (
      await chooser
    ).setFiles({
      name: 'owned.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'),
    });
    await expect(page.getByText('owned.svg', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Конвертувати', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Прибрати файл', exact: true }).click();
    await expect(picker).toBeFocused();
    const disclosure = page.locator('summary').filter({ hasText: 'Вимоги до файлів' });
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(disclosure.locator('..')).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(disclosure.locator('..')).not.toHaveAttribute('open');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test('all enabled source formats offer only their supported targets in the browser', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4174/test-fixtures/converter/');
  const raster = ['jpg', 'png', 'webp', 'avif'];
  // Selection only: content and real-engine proof belong to the Linux suites.
  for (const source of [...raster, 'gif', 'svg', 'docx', 'odt', 'xlsx', 'pptx', 'csv', 'txt']) {
    await page.getByLabel('Файл для конвертації').setInputFiles({
      name: `owned.${source}`,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('synthetic selection fixture'),
    });
    await expect(page.getByText(`owned.${source}`, { exact: true })).toBeVisible();
    const expected = raster.includes(source)
      ? raster.filter((target) => target !== source)
      : ['gif', 'svg'].includes(source)
        ? raster
        : ['pdf'];
    expect(
      await page
        .getByLabel('Конвертувати у')
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    ).toEqual(expected);
  }
});
