import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveDownload } from './save-download';

const create = vi.fn(() => 'blob:synthetic-result');
const revoke = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ['../../report.pdf', 'report.pdf'],
  ['C:\\uploads\\photo\u0000.png', 'photo.png'],
  ['', 'result'],
])(
  'downloads owned bytes with a safe filename for %j, then releases the URL',
  async (name, safe) => {
    const blob = new Blob(['synthetic output']);
    let clicked: { href: string | null; name: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = { href: this.getAttribute('href'), name: this.download };
      expect(this.isConnected).toBe(true);
    });
    saveDownload(blob, name);
    expect(create).toHaveBeenCalledWith(blob);
    expect(clicked?.href).toBe('blob:synthetic-result');
    expect(clicked?.name).toBe(safe);
    expect(document.querySelector('a[download]')).toBeNull();
    await vi.advanceTimersByTimeAsync(999);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:synthetic-result');
  },
);

it('removes the link and releases its URL even when the browser rejects the click', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    throw new Error('Synthetic click failure');
  });
  expect(() => saveDownload(new Blob(['output']), 'result.png')).toThrow('Synthetic click failure');
  expect(click).toHaveBeenCalledTimes(1);
  expect(document.querySelector('a[download]')).toBeNull();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:synthetic-result');
});

it('rejects empty results before allocating a URL or triggering a download', () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(() => saveDownload(new Blob(), 'empty.pdf')).toThrow('Empty download.');
  expect(create).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
