import { expect, test, type Page } from '@playwright/test';

const upload = async (page: Page, name = 'phase5.jpg') => {
  await page
    .getByLabel('Файл для конвертації')
    .setInputFiles({ name, mimeType: 'image/jpeg', buffer: Buffer.from('owned synthetic input') });
};

test('production routes preserve selection through API/auth navigation and history, but not reload or sign-in', async ({
  page,
}) => {
  let authenticated = false;
  const session = () =>
    authenticated
      ? {
          kind: 'authenticated',
          user: { id: 'synthetic', email: 'phase5@example.test', displayName: '' },
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        }
      : { kind: 'anonymous' };
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({ json: session() }));
  await page.route('**/api/v1/auth/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'synthetic' } }),
  );
  await page.route('**/api/v1/guest-session', (route) =>
    route.fulfill({ json: { trialState: 'available', activeConversionId: null } }),
  );
  await page.route('**/api/v1/auth/login', (route) => {
    authenticated = true;
    return route.fulfill({ json: session() });
  });
  await page.goto('/');
  await upload(page);
  await page.locator('#primary-navigation a[href="/api-docs"]').click();
  await page.goBack();
  await expect(page.getByText('phase5.jpg', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveValue('png');
  await page.locator('#primary-navigation a[href="/login"]').click();
  await page.getByRole('link', { name: 'До конвертера' }).click();
  await expect(page.getByText('phase5.jpg', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('phase5.jpg', { exact: true })).toHaveCount(0);
  await upload(page);
  await page.locator('#primary-navigation a[href="/login"]').click();
  await page.getByLabel('Електронна пошта', { exact: true }).fill('phase5@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Увійти', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'Вибрати файл', exact: true })).toBeEnabled();
  await expect(page.getByText('phase5.jpg', { exact: true })).toHaveCount(0);
});

for (const width of [320, 768, 1366]) {
  test(`stable retry, result, reset and focus with long filenames at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:4174/test-fixtures/converter/?scenario=failed-once');
    await upload(page, `${'long-name-'.repeat(15)}.jpg`);
    const shell = page.locator('[data-home-hero] > div').last();
    const initial = (await shell.boundingBox())!;
    await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Завантажуємо файл' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Змінити файл' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Не вдалося конвертувати' })).toBeVisible({
      timeout: 15_000,
    });
    const failed = (await shell.boundingBox())!;
    expect(Math.abs(failed.height - initial.height)).toBeLessThan(2);
    await page.getByRole('button', { name: 'Повторити конвертацію' }).click();
    await expect(page.getByRole('combobox')).toHaveValue('png');
    await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible({
      timeout: 15_000,
    });
    const result = (await shell.boundingBox())!;
    expect(Math.abs(result.height - initial.height)).toBeLessThan(2);
    expect(
      await page
        .getByRole('region', { name: 'Стан конвертації' })
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('none');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
    await (await download).delete();
    await page.getByRole('button', { name: 'Конвертувати інший файл' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Конвертувати інший файл' })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test('account success clears the draft and reset keeps shell height', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/test-fixtures/converter/?scenario=saved');
  await upload(page);
  const shell = page.locator('[data-home-hero] > div').last();
  const height = (await shell.boundingBox())!.height;
  await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Файл готовий' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Конвертувати інший файл' }).click();
  await expect(page.getByRole('button', { name: 'Вибрати файл', exact: true })).toBeFocused();
  await expect(page.getByText('phase5.jpg', { exact: true })).toHaveCount(0);
  expect(Math.abs((await shell.boundingBox())!.height - height)).toBeLessThan(2);
});
