import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// HTTP protocol fixtures exercise the production UI; real admission/accounting is
// covered by guest-recovery.live.ts, conversions.live.ts and processing.live.ts.
const id = '07010000-0000-4000-8000-000000000001';
async function server(context: BrowserContext) {
  const state = {
    email: null as string | null,
    owner: undefined as string | null | undefined,
    active: false,
    completed: false,
    expired: false,
    pollingOffline: false,
    downloadOffline: false,
    posts: 0,
    downloads: 0,
  };
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/session'))
      return route.fulfill({
        json: state.email
          ? {
              kind: 'authenticated',
              user: { id: state.email, email: state.email, displayName: '' },
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            }
          : { kind: 'anonymous' },
      });
    if (path.endsWith('/auth/csrf')) return route.fulfill({ json: { csrfToken: 'synthetic' } });
    if (path.endsWith('/guest-session'))
      return route.fulfill({
        json: {
          trialState: state.completed ? 'consumed' : state.active ? 'reserved' : 'available',
          activeConversionId: state.active ? id : null,
        },
      });
    const summary = {
      id,
      sourceFormat: 'jpg',
      targetFormat: 'png',
      createdAt: new Date().toISOString(),
      saveResult: false,
    };
    if (path.endsWith('/conversions')) {
      state.posts++;
      state.active = true;
      state.owner = state.email;
      return route.fulfill({ status: 202, json: { ...summary, status: 'queued' } });
    }
    if (path.endsWith('/download')) {
      state.downloads++;
      if (state.downloadOffline) return route.abort('internetdisconnected');
      if (state.expired)
        return route.fulfill({
          status: 410,
          json: { error: { code: 'RESULT_EXPIRED', message: 'Expired' } },
        });
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      });
    }
    if (path.endsWith(`/conversions/${id}`)) {
      if (state.owner === undefined) state.owner = state.email;
      if (state.owner && state.owner !== state.email)
        return route.fulfill({
          status: 404,
          json: { error: { code: 'NOT_FOUND', message: 'Not found' } },
        });
      if (state.pollingOffline) return route.abort('internetdisconnected');
      return route.fulfill({
        json: {
          ...summary,
          status: state.completed ? 'completed' : 'processing',
          completedAt: state.completed ? new Date().toISOString() : null,
          error: null,
          resultAvailability: state.completed
            ? state.expired
              ? 'expired'
              : 'available'
            : 'pending',
          result: state.completed
            ? {
                id,
                owner: state.owner ? 'account' : 'guest',
                name: 'owned-result.png',
                format: 'png',
                sizeBytes: 8,
                retention: 'temporary',
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                availability: state.expired ? 'expired' : 'available',
              }
            : null,
        },
      });
    }
    throw new Error(`Unexpected synthetic endpoint: ${path}`);
  });
  return state;
}
async function select(page: Page) {
  await expect(page.getByLabel('Файл для конвертації')).toBeEnabled();
  await page.getByLabel('Файл для конвертації').setInputFiles({
    name: 'owned-draft.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('synthetic'),
  });
  await expect(page.getByRole('button', { name: 'Конвертувати', exact: true })).toBeEnabled();
}

async function visibility(page: Page, value: 'hidden' | 'visible') {
  // Headless tabs can remain visible simultaneously; dispatch both real lifecycle states.
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, value);
}

test('known processing ID survives transport failure, reload and expiry without replay', async ({
  page,
  context,
}) => {
  const state = await server(context);
  await page.goto('/');
  await select(page);
  await page.getByRole('button', { name: 'Конвертувати', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: 'Конвертуємо файл' })).toBeVisible();
  state.pollingOffline = true;
  await expect(page.getByRole('heading', { name: 'Відновлюємо зв’язок' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Не вдалося конвертувати' })).toHaveCount(0);
  state.pollingOffline = false;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Конвертуємо файл' })).toBeVisible();
  state.completed = true;
  state.expired = true;
  await expect(page.getByText(/Результат більше недоступний/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Завантажити', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Конвертувати інший файл' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.posts).toBe(1);
});

test('download transport failure permits explicit retry without a conversion replay', async ({
  page,
  context,
}) => {
  const state = await server(context);
  state.active = state.completed = state.downloadOffline = true;
  await page.goto(`/?conversion=${id}`);
  await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Конвертація завершена');
  state.downloadOffline = false;
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
  await (await download).delete();
  expect(state.downloads).toBe(2);
  expect(state.posts).toBe(0);
});

test('a second tab changes the principal; visibility synchronization clears the first draft', async ({
  page,
  context,
}) => {
  const state = await server(context);
  state.email = 'first@example.test';
  await page.goto('/');
  await select(page);
  await visibility(page, 'hidden');
  const second = await context.newPage();
  await second.goto('/');
  await second.route('**/api/v1/auth/logout', async (route) => {
    state.email = null;
    await route.fulfill({ status: 204 });
  });
  await second.getByRole('button', { name: 'Вийти', exact: true }).click();
  await expect(second.locator('#primary-navigation a[href="/login"]')).toBeVisible();
  await page.bringToFront();
  await visibility(page, 'visible');
  await expect(page.locator('#primary-navigation a[href="/login"]')).toBeVisible();
  await expect(page.getByText('owned-draft.jpg', { exact: true })).toHaveCount(0);
  expect(state.posts).toBe(0);
});

test('a delayed private download is discarded after another tab changes the account', async ({
  page,
  context,
}) => {
  const state = await server(context);
  state.email = 'first@example.test';
  state.active = state.completed = true;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/download', async (route) => {
    requested();
    await held;
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
  });
  const downloads: string[] = [];
  page.on('download', (download) => {
    downloads.push(download.suggestedFilename());
  });
  try {
    await page.goto(`/?conversion=${id}`);
    await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
    await started;
    await visibility(page, 'hidden');
    const second = await context.newPage();
    await second.goto('/api-docs');
    await second.route('**/api/v1/auth/logout', async (route) => {
      state.email = null;
      await route.fulfill({ status: 204 });
    });
    await second.getByRole('button', { name: 'Вийти', exact: true }).click();
    await expect(second.locator('#primary-navigation a[href="/login"]')).toBeVisible();
    await page.bringToFront();
    await visibility(page, 'visible');
    await expect(page.locator('#primary-navigation a[href="/login"]')).toBeVisible();
    const received = page.waitForResponse((response) => response.url().endsWith('/download'));
    release();
    await received;
    // Flush Blob creation and the native download event after the held response.
    await page.waitForTimeout(300);
    expect(downloads).toEqual([]);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const transition of ['sign-in', 'account-switch', 'session-expiry'] as const) {
  test(`${transition} clears an inactive tab draft on return without replay`, async ({
    page,
    context,
  }) => {
    const state = await server(context);
    state.email = transition === 'sign-in' ? null : 'first@example.test';
    await page.goto('/');
    await select(page);
    await visibility(page, 'hidden');
    const second = await context.newPage();
    await second.goto('/api-docs');
    if (transition === 'session-expiry') {
      // Server-side revocation/expiry is separately exercised by auth.live.ts.
      state.email = null;
    } else {
      await second.route('**/api/v1/auth/login', async (route) => {
        state.email = 'second@example.test';
        await route.fulfill({
          json: {
            kind: 'authenticated',
            user: { id: 'second', email: state.email, displayName: '' },
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
        });
      });
      await second.evaluate(async () => {
        await fetch('/api/v1/auth/login', { method: 'POST', body: '{}' });
      });
    }
    const synchronized = page.waitForResponse((response) =>
      response.url().endsWith('/auth/session'),
    );
    await page.bringToFront();
    await visibility(page, 'visible');
    const session = (await (await synchronized).json()) as {
      kind: string;
      user?: { email: string };
    };
    expect(session.kind).toBe(transition === 'session-expiry' ? 'anonymous' : 'authenticated');
    if (transition !== 'session-expiry') expect(session.user?.email).toBe('second@example.test');
    await expect(page.getByText('owned-draft.jpg', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Вибрати файл', exact: true })).toBeEnabled();
    expect(state.posts).toBe(0);
  });
}
