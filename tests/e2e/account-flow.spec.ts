import { expect, test, type Page } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:4174' });
async function open(page: Page, scenario = 'success') {
  await page.goto(`/test-fixtures/account/?scenario=${scenario}#/account`);
  await expect(page.getByRole('note')).toContainText('вигадані дані');
  await expect(page.getByRole('heading', { level: 1, name: 'Профіль' })).toBeVisible();
}
async function rotate(page: Page) {
  await page.getByRole('button', { name: 'Перевипустити ключ', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Поточний пароль', { exact: true }).fill('synthetic-current');
  await dialog.getByRole('button', { name: 'Перевипустити ключ', exact: true }).click();
}
test('profile confirmation, password validation and successful credential change', async ({
  page,
}) => {
  await open(page);
  const form = page.getByRole('form', { name: 'Особисті дані' });
  await form.getByLabel('Ім’я', { exact: true }).fill('Нове ім’я');
  await form.getByRole('button', { name: 'Зберегти дані' }).click();
  await expect(form.getByLabel('Поточний пароль', { exact: true })).toBeFocused();
  await form.getByLabel('Поточний пароль', { exact: true }).fill('wrong');
  await form.getByRole('button', { name: 'Зберегти дані' }).click();
  await expect(form.getByRole('alert')).toContainText('Перевірте поточний пароль');
  await form.getByLabel('Поточний пароль', { exact: true }).fill('synthetic-current');
  await form.getByRole('button', { name: 'Зберегти дані' }).click();
  await expect(form.getByRole('status')).toHaveText('Особисті дані збережено.');
  await expect(form.getByLabel('Поточний пароль', { exact: true })).toBeEmpty();
  const security = page.getByRole('form', { name: 'Зміна пароля' });
  await security.getByLabel('Поточний пароль', { exact: true }).fill('synthetic-current');
  await security.getByLabel('Новий пароль', { exact: true }).fill('synthetic-new');
  await security.getByLabel('Повторіть новий пароль', { exact: true }).fill('different');
  await security.getByRole('button', { name: 'Змінити пароль' }).click();
  await expect(security.getByText('Паролі не збігаються.')).toBeVisible();
  await security.getByLabel('Повторіть новий пароль', { exact: true }).fill('synthetic-new');
  await security.getByRole('button', { name: 'Змінити пароль' }).click();
  await expect(page.getByText('Пароль змінено. Увійдіть із новим паролем.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Увійти' })).toBeVisible();
});
test('one-time key copy, irreversible hiding and dialog keyboard behavior', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  const opener = page.getByRole('button', { name: 'Перевипустити ключ', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Скасувати' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await rotate(page);
  await expect(page.getByLabel('Новий API-ключ', { exact: true })).toHaveValue(
    'fixture_key_public_demo_1',
  );
  await page.getByRole('button', { name: 'Копіювати ключ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ключ скопійовано' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'fixture_key_public_demo_1',
  );
  await rotate(page);
  await expect(page.getByLabel('Новий API-ключ', { exact: true })).toHaveValue(
    'fixture_key_public_demo_2',
  );
  await expect(page.getByRole('button', { name: 'Копіювати ключ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Приховати назавжди' }).click();
  await expect(page.getByLabel('Новий API-ключ', { exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Маскований API-ключ')).toHaveText('demo_2••••••••');
});
test('ambiguous rotation blocks replay, while settings reconcile a committed write after a lost response', async ({
  page,
}) => {
  await open(page, 'key-unknown');
  await rotate(page);
  await expect(page.getByText(/Ключ міг бути створений або замінений/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Перевипустити ключ', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Оновити дані ключа' }).click();
  await expect(page.getByLabel('Маскований API-ключ')).toHaveText('demo_1••••••••');
  await expect(page.getByRole('button', { name: 'Перевипустити ключ', exact: true })).toBeEnabled();
  await open(page, 'settings-unknown');
  const toggle = page.getByRole('switch');
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.getByText(/Зміна не підтверджена/)).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
});
test('account read retries, anonymous access and responsive layouts remain usable', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, 'profile-read-error');
  await page.getByRole('button', { name: 'Повторити завантаження профілю' }).click();
  await expect(page.getByRole('form', { name: 'Особисті дані' })).toBeVisible();
  await open(page, 'anonymous');
  await expect(page.getByRole('link', { name: 'Увійти до акаунту' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Особисті дані' })).not.toBeVisible();
  for (const width of [320, 390, 768, 1366, 1505]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await expect(page.getByRole('form', { name: 'Особисті дані' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});
