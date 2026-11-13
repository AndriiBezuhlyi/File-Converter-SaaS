import { expect, test } from '@playwright/test';

for (const width of [320, 768, 1366]) {
  test(`file requirements restore converter height after closing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/v1/auth/session', (route) =>
      route.fulfill({ json: { kind: 'anonymous' } }),
    );
    await page.route('**/api/v1/auth/csrf', (route) =>
      route.fulfill({ json: { csrfToken: 'synthetic' } }),
    );
    await page.route('**/api/v1/guest-session', (route) =>
      route.fulfill({ json: { trialState: 'available', activeConversionId: null } }),
    );
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Вибрати файл', exact: true })).toBeEnabled();
    await expect(
      page.getByText('1 файл безкоштовно без реєстрації', { exact: true }),
    ).toBeVisible();
    const disclosure = page
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: 'Вимоги до файлів' }) });
    const summary = disclosure.locator('summary');
    const shell = page.locator('[data-home-hero] > div').last();
    for (const selected of [false, true]) {
      if (selected)
        await page.getByLabel('Файл для конвертації').setInputFiles({
          name: 'synthetic.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from('synthetic selection only'),
        });
      const initial = (await shell.boundingBox())!.height;
      for (let attempt = 0; attempt < 2; attempt++) {
        await summary.click();
        await expect(disclosure).toHaveAttribute('open', '');
        await expect
          .poll(async () => (await shell.boundingBox())!.height)
          .toBeGreaterThan(initial + 20);
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(disclosure).not.toHaveAttribute('open');
        await expect
          .poll(async () => Math.abs((await shell.boundingBox())!.height - initial))
          .toBeLessThan(2);
      }
    }
  });
}
