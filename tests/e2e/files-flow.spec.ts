import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:4174' });
async function open(page: Page, scenario = 'success') {
  await page.goto(`/test-fixtures/account/?scenario=${scenario}#/files`);
  await expect(page).toHaveTitle('Мої файли — converter');
  await expect(page.getByRole('note')).toContainText('вигадані дані');
}
function list(page: Page) {
  return page.getByRole('list', { name: 'Збережені файли' });
}
test('cursor pages, date ordering, output filtering and debounced search', async ({ page }) => {
  await open(page);
  await expect(list(page).getByRole('article')).toHaveCount(3);
  await page.getByRole('button', { name: 'Показати ще' }).click();
  await expect(list(page).getByRole('article')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Показати ще' })).not.toBeVisible();
  await page.getByLabel('Тип файлу', { exact: true }).selectOption('pdf');
  await expect(list(page).getByRole('article')).toHaveCount(2);
  await page.getByLabel('За датою', { exact: true }).selectOption('oldest');
  await expect(list(page).getByRole('article').first()).toHaveAccessibleName('another-notes.pdf');
  await page.getByLabel('Пошук за назвою', { exact: true }).fill('ANOTHER');
  await expect(list(page).getByRole('article')).toHaveCount(1);
  await expect(list(page).getByRole('article')).toHaveAccessibleName('another-notes.pdf');
  await page.getByLabel('Пошук за назвою', { exact: true }).fill('missing-file');
  await expect(page.getByRole('heading', { name: 'Нічого не знайдено' })).toBeVisible();
  await page.getByRole('button', { name: 'Скинути фільтри' }).click();
  await expect(list(page).getByRole('article', { name: 'example-image.png' })).toBeVisible();
});
test('downloads actual PNG/JPG/PDF bytes and shows details, cancel and confirmed deletion', async ({
  page,
}) => {
  await open(page);
  for (const [name, header] of [
    ['example-image.png', [137, 80, 78, 71]],
    ['sample-photo.jpg', [255, 216, 255]],
    ['notes.pdf', [37, 80, 68, 70]],
  ] as const) {
    const received = page.waitForEvent('download');
    await list(page)
      .getByRole('article', { name })
      .getByRole('button', { name: 'Завантажити', exact: true })
      .click();
    const download = await received;
    expect(download.suggestedFilename()).toBe(name);
    const path = await download.path();
    const bytes = await readFile(path);
    expect([...bytes.subarray(0, header.length)]).toEqual([...header]);
    await download.delete();
  }
  const row = list(page).getByRole('article', { name: 'example-image.png' });
  await row.getByRole('button', { name: 'Деталі' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('90 Б', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: 'Деталі' })).toBeFocused();
  await row.getByRole('button', { name: 'Видалити', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Скасувати' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Скасувати' }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Видалити', exact: true }).click();
  await dialog.getByRole('button', { name: 'Видалити файл', exact: true }).click();
  await expect(page.getByText('Файл видалено.')).toBeVisible();
  await expect(row).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});
test('network failures retain rows, denial removes download, and delete errors do not leak into another confirmation', async ({
  page,
}) => {
  await open(page, 'download-error');
  const row = list(page).getByRole('article', { name: 'example-image.png' });
  await row.getByRole('button', { name: 'Завантажити', exact: true }).click();
  await expect(row.getByRole('alert')).toContainText('Перевірте з’єднання');
  const received = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Завантажити', exact: true }).click();
  await (await received).delete();
  await open(page, 'delete-error');
  await row.getByRole('button', { name: 'Видалити', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Видалити файл', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Перевірте з’єднання');
  await dialog.getByRole('button', { name: 'Скасувати' }).click();
  await expect(row).toBeVisible();
  await list(page)
    .getByRole('article', { name: 'notes.pdf' })
    .getByRole('button', { name: 'Видалити', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await open(page, 'download-denied');
  await row.getByRole('button', { name: 'Завантажити', exact: true }).click();
  await expect(page.getByText(/Файл більше недоступний для завантаження. Список/)).toBeVisible();
  await expect(row).not.toBeVisible();
});
test('shared auto-save survives account/files navigation and never removes existing files', async ({
  page,
}) => {
  await open(page);
  const toggle = page.getByRole('switch');
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  const nav = page.getByRole('navigation', { name: 'Основна навігація' });
  await nav.getByRole('link', { name: 'Профіль', exact: true }).click();
  await expect(page.getByRole('switch')).not.toBeChecked();
  await page.getByRole('switch').click();
  await expect(page.getByRole('switch')).toBeChecked();
  await nav.getByRole('link', { name: 'Мої файли', exact: true }).click();
  await expect(page.getByRole('switch')).toBeChecked();
  await expect(list(page).getByRole('article')).toHaveCount(3);
});
test('empty state, retry, anonymous/production gates and responsive file actions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'empty');
  await expect(page.getByRole('heading', { name: 'Ще немає збережених файлів' })).toBeVisible();
  await open(page, 'files-read-error');
  await page.getByRole('button', { name: 'Оновити список' }).click();
  await expect(list(page).getByRole('article')).toHaveCount(3);
  await open(page, 'anonymous');
  await expect(page.getByRole('link', { name: 'Увійти до акаунту' })).toBeVisible();
  await expect(list(page)).not.toBeVisible();
  for (const width of [320, 390, 768, 1366, 1505]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await expect(list(page).getByRole('article')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const row = list(page).getByRole('article', { name: 'example-image.png' });
    await row.getByRole('button', { name: 'Видалити', exact: true }).click();
    const bounds = await page.getByRole('dialog').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
  }
  await page.goto('http://127.0.0.1:4173/files');
  await expect(
    page.getByText('Цей розділ ще не підключено. Дані акаунту наразі недоступні.'),
  ).toBeVisible();
  await expect(list(page)).not.toBeVisible();
  expect(errors).toEqual([]);
});
