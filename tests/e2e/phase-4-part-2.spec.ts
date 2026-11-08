import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174', trace: 'off' });

test('deletion notice refreshes, fades, expires and stays cleared after navigation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/test-fixtures/account/#/files');
  await expect(page).toHaveTitle('Мої файли — Flux Converter');
  await page.clock.install();
  async function remove(name: string) {
    await page
      .getByRole('article', { name })
      .getByRole('button', { name: 'Видалити', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Видалити файл', exact: true })
      .click();
    await expect(page.getByText('Файл видалено.', { exact: true })).toBeVisible();
  }
  await remove('example-image.png');
  await page.clock.runFor(3000);
  await remove('notes.pdf');
  await expect(page.getByText('Файл видалено.', { exact: true })).toHaveCount(1);
  await page.clock.runFor(3000);
  await expect(page.getByText('Файл видалено.', { exact: true })).toBeVisible();
  await page.clock.runFor(1100);
  await expect(page.getByText('Файл видалено.', { exact: true })).toHaveCount(0);
  await remove('sample-photo.jpg');
  const nav = page.getByRole('navigation', { name: 'Основна навігація' });
  await nav.getByRole('link', { name: 'Профіль', exact: true }).click();
  await page.clock.runFor(5000);
  await nav.getByRole('link', { name: 'Мої файли', exact: true }).click();
  await expect(page.getByText('Файл видалено.', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('native hide dialog supports cancellation, keyboard focus and explicit hide', async ({
  page,
}) => {
  await page.goto('/test-fixtures/account/#/account');
  const rotate = page.getByRole('button', { name: 'Перевипустити ключ', exact: true });
  await rotate.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Поточний пароль', { exact: true }).fill('synthetic-current');
  await dialog.getByRole('button', { name: 'Перевипустити ключ', exact: true }).click();
  const secret = page.getByLabel('Новий API-ключ', { exact: true });
  await expect(secret).toHaveValue('fixture_key_public_demo_1');
  const hide = page.getByRole('button', { name: 'Приховати назавжди' });
  await hide.click();
  await expect(dialog.getByRole('button', { name: 'Скасувати' })).toBeFocused();
  await expect(dialog).toContainText('Приховування не відкликає ключ');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Закрити діалог' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(hide).toBeFocused();
  await expect(secret).toHaveValue('fixture_key_public_demo_1');
  await hide.click();
  await dialog.getByRole('button', { name: 'Скасувати' }).click();
  await expect(secret).toHaveValue('fixture_key_public_demo_1');
  await hide.click();
  await dialog.getByRole('button', { name: 'Приховати ключ', exact: true }).click();
  await expect(secret).toHaveCount(0);
  await expect(rotate).toBeFocused();
  await expect(page.getByLabel('Маскований API-ключ')).toHaveText('demo_1••••••••');
});

test('registration reassurance is readable on mobile and new-password paste keeps spaces and Unicode', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test-fixtures/auth/#/register');
  await expect(page.getByText('Без спаму. Писатимемо лише щодо вашого акаунту.')).toBeVisible();
  const password = page.getByLabel('Пароль', { exact: true });
  const confirmation = page.getByLabel('Повторіть пароль', { exact: true });
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await page.getByLabel('Електронна пошта', { exact: true }).fill('owned@example.test');
  await password.fill('Password123!');
  await confirmation.fill('Password123!');
  await page.getByRole('button', { name: 'Створити акаунт', exact: true }).click();
  await expect(page.getByText(/Цей пароль надто поширений/)).toBeVisible();
  const phrase = ' 😀 a quiet river at dawn ';
  await password.fill('');
  await password.focus();
  await page.keyboard.insertText(phrase);
  await confirmation.fill(phrase);
  await expect(password).toHaveValue(phrase);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Створити акаунт', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Підтвердження пошти' })).toBeVisible();
});
