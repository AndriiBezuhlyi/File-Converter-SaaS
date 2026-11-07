import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useActiveSection } from './use-active-section';
import { sections } from './api-reference';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('tracks deterministic heading boundaries, rapid jumps, resize, bottom and layout changes without history writes', async () => {
  let y = 0;
  let frame: FrameRequestCallback | undefined;
  let resize: ResizeObserverCallback | undefined;
  const disconnect = vi.fn();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frame = undefined;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(3000);
  const push = vi.spyOn(history, 'pushState');
  const replace = vi.spyOn(history, 'replaceState');
  for (const [index, { id }] of sections.entries()) {
    const heading = document.createElement('h2');
    heading.id = id;
    heading.style.scrollMarginBlockStart = '24px';
    vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 200 + index * 400 - y }) as DOMRect,
    );
    document.body.append(heading);
  }
  const flush = () => {
    act(() => {
      const callback = frame;
      frame = undefined;
      callback?.(0);
    });
  };
  const { result, unmount } = renderHook(useActiveSection);
  await act(async () => {});
  flush();
  expect(result.current).toBe('quick-start');
  y = 576;
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
  flush();
  expect(result.current).toBe('authentication');
  y = 577;
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
  flush();
  expect(result.current).toBe('authentication');
  y = 1776;
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
  flush();
  expect(result.current).toBe('limits');
  y = 2400;
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  flush();
  expect(result.current).toBe('errors');
  y = 0;
  act(() => resize?.([], {} as ResizeObserver));
  flush();
  expect(result.current).toBe('quick-start');
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('scroll'));
  expect(frame).toBeUndefined();
});

it('keeps working without observer support', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  const { result } = renderHook(useActiveSection);
  expect(result.current).toBe('quick-start');
});
