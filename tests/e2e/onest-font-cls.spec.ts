import { expect, test } from '@playwright/test';

for (const delayPreload of [false, true]) {
  for (const width of [320, 375, 390, 504, 768, 1366]) {
    test(`hero geometry survives delayed Onest at ${width}px (preload delayed: ${delayPreload})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(() => {
        const shifts: { at: number; value: number; sources: string[] }[] = [];
        Object.defineProperty(window, '__onestFontShifts', { value: shifts });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
              sources?: { node?: Node }[];
            };
            if (!shift.hadRecentInput) {
              shifts.push({
                at: shift.startTime,
                value: shift.value,
                sources: (shift.sources ?? []).map(({ node }) =>
                  node instanceof Element
                    ? `${node.tagName}.${node.getAttribute('class') ?? ''}`
                    : '',
                ),
              });
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      let releaseFonts!: () => void;
      const fontsHeld = new Promise<void>((resolve) => {
        releaseFonts = resolve;
      });
      await page.route('**/fonts/onest/**', async (route) => {
        // Reproduce the existing Cyrillic-600 preload arriving before the other subsets.
        if (delayPreload || !route.request().url().endsWith('/onest-cyrillic-600-normal.woff2')) {
          await fontsHeld;
        }
        await route.continue();
      });
      const geometry = () =>
        page.evaluate(() =>
          ['main h1', '[data-home-hero] > div > p', '[class*="workspace"]'].map((selector) => {
            const element = document.querySelector(selector)!;
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
      try {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('input[type="file"]')).toBeEnabled();
        if (!delayPreload) {
          await page.evaluate(() => document.fonts.load('600 50px Onest', 'Конвертуй'));
        }
        // Format labels use a different font. Settle it independently so the
        // CLS assertion measures Onest replacement, not IBM Plex Mono swapping.
        await page.evaluate(() =>
          Promise.all([
            document.fonts.load('400 20px "IBM Plex Mono"', 'JPG'),
            document.fonts.load('400 20px "IBM Plex Mono"', 'Конвертер'),
          ]),
        );
        // Observe a painted fallback layout before measuring the font swap,
        // keeping initial React mounting/first-paint activity out of its CLS.
        await page.waitForFunction(
          () => performance.getEntriesByName('first-contentful-paint').length > 0,
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const before = await geometry();
        const swapStartedAt = await page.evaluate(() => performance.now());
        releaseFonts();
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const after = await geometry();
        // The below-fold workspace may change height as its own control labels swap.
        for (let index = 0; index < before.length; index++) {
          for (const key of ['x', 'y', 'width'] as const) {
            expect(after[index]![key]).toBeCloseTo(before[index]![key], 1);
          }
          if (index < 2) expect(after[index]!.height).toBe(before[index]!.height);
        }
        await page.waitForTimeout(150);
        expect(await geometry()).toEqual(after);
        const fontState = await page.evaluate((startedAt) => {
          const fontWindow = window as unknown as {
            __onestFontShifts: { at: number; value: number; sources: string[] }[];
          };
          return {
            cls: fontWindow.__onestFontShifts
              .filter((shift) => shift.at >= startedAt)
              .reduce((sum, shift) => sum + shift.value, 0),
            shifts: fontWindow.__onestFontShifts.filter((shift) => shift.at >= startedAt),
            onestLoaded: document.fonts.check('600 50px Onest', 'Конвертуй'),
            loadedFace: [...document.fonts].some(
              (face) =>
                face.family === 'Onest' && face.weight === '600' && face.status === 'loaded',
            ),
            unclipped: [...document.querySelectorAll('main h1, [data-home-hero] > div > p')].every(
              (element) => {
                const style = getComputedStyle(element);
                return !['hidden', 'clip'].includes(style.overflow) && style.clipPath === 'none';
              },
            ),
          };
        }, swapStartedAt);
        await test.info().attach('font-swap', {
          body: JSON.stringify(fontState, null, 2),
          contentType: 'application/json',
        });
        // Measured residual control/icon shifts stay below 0.005 on both platforms;
        // the Linux regression produces 0.015–0.066 and must still fail.
        expect(fontState.cls).toBeLessThan(0.005);
        expect(fontState.onestLoaded).toBe(true);
        expect(fontState.loadedFace).toBe(true);
        expect(fontState.unclipped).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      } finally {
        releaseFonts();
      }
    });
  }
}
