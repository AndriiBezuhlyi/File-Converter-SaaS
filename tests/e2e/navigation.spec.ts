import { expect, test } from '@playwright/test';

test('keyboard skip link, route navigation, deep links, and 404 recovery work', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Перейти до вмісту' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page
    .getByRole('navigation', { name: 'Основна навігація' })
    .getByRole('link', { name: 'API' })
    .click();
  await expect(page).toHaveURL('/api-docs');
  await expect(page).toHaveTitle('Документація API — converter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Документація API' })).toBeVisible();
  for (const path of [
    '/login',
    '/register',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
    '/account',
    '/files',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Сторінку не знайдено' })).toHaveCount(0);
  }
  await page.goto('/not-a-page');
  await expect(page.getByRole('heading', { name: 'Сторінку не знайдено' })).toBeVisible();
  await page.getByRole('link', { name: 'До конвертера' }).click();
  await expect(page).toHaveURL('/');
});

test('mobile disclosure closes on Escape and navigation, with no horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Відкрити меню' });
  const navigation = page.getByRole('navigation', { name: 'Основна навігація' });
  await expect(navigation).toBeHidden();
  await menu.click();
  await expect(navigation).toBeVisible();
  await navigation.getByRole('link', { name: 'API' }).focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(navigation).toBeHidden();
  await menu.click();
  await navigation.getByRole('link', { name: 'Увійти' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Увійти' })).toBeVisible();
  await expect(navigation).toBeHidden();
  for (const width of [320, 390, 768, 1024, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});
