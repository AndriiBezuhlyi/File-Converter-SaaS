import { expect, test } from '@playwright/test';

test('production frontend bundle mounts without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Конвертер файлів — Clarity Converter');
  await expect(page.getByRole('main', { name: 'Clarity Converter' })).toBeVisible();
  expect(errors).toEqual([]);
});
