import { expect, test } from '@playwright/test';

for (const width of [320, 390, 768, 1366]) {
  test(`rename pencil precedes a long Unicode filename and remains keyboard accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const name = 'Довга-назва-café-'.repeat(10) + '.png';
    await page.route('**/api/v1/auth/session', (route) =>
      route.fulfill({
        json: {
          kind: 'authenticated',
          user: { id: 'synthetic-owner', email: 'reader@example.test', displayName: '' },
          expiresAt: '2030-01-01T00:00:00Z',
        },
      }),
    );
    await page.route('**/api/v1/users/me/settings', (route) =>
      route.fulfill({ json: { autoSave: true } }),
    );
    await page.route('**/api/v1/files?*', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: '56f27a77-5cb6-478c-bd20-1164c808944a',
              name,
              format: 'png',
              sizeBytes: 42,
              createdAt: '2026-11-13T10:00:00Z',
              retention: 'saved',
              expiresAt: null,
            },
          ],
          nextCursor: null,
        },
      }),
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/files');
    const row = page.getByRole('article', { name });
    const pencil = row.getByRole('button', { name: 'Перейменувати', exact: true });
    await expect(pencil).toHaveAttribute('title', 'Перейменувати файл');
    const iconBounds = await pencil.boundingBox();
    const nameBounds = await row.getByRole('heading', { name }).boundingBox();
    expect(iconBounds).not.toBeNull();
    expect(nameBounds).not.toBeNull();
    expect(iconBounds!.x + iconBounds!.width).toBeLessThan(nameBounds!.x);
    expect(iconBounds!.width).toBeGreaterThanOrEqual(44);
    expect(iconBounds!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await row
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('aria-label') || button.textContent),
        ),
    ).toEqual(['Перейменувати', 'Деталі', 'Завантажити', 'Видалити']);
    await pencil.focus();
    await expect(pencil).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Назва файлу' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(pencil).toBeFocused();
    expect(errors).toEqual([]);
  });
}
