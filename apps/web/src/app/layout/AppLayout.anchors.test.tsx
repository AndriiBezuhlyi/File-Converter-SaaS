import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';

let frame: FrameRequestCallback | undefined;
const scrollTo = vi.fn();
beforeEach(() => {
  frame = undefined;
  scrollTo.mockClear();
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frame = undefined;
  });
});
afterEach(() => vi.restoreAllMocks());

function renderRoute(path: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Link to="/api-docs#%61uthentication">Open section</Link>} />
            <Route
              path="/api-docs"
              element={
                <h2 id="authentication" tabIndex={-1}>
                  Section
                </h2>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

async function flush() {
  await act(async () => {});
  act(() => {
    const callback = frame;
    frame = undefined;
    callback?.(0);
  });
}

it('restores an encoded initial fragment and target focus under StrictMode', async () => {
  renderRoute('/api-docs#%61uthentication');
  const heading = screen.getByRole('heading');
  const scroll = vi.fn();
  heading.scrollIntoView = scroll;
  await flush();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'instant' });
  expect(heading).toHaveFocus();
  expect(scrollTo).not.toHaveBeenCalled();
});

it('reveals the cross-route fragment without the pathname reset competing', async () => {
  renderRoute('/');
  fireEvent.click(screen.getByRole('link', { name: 'Open section' }));
  const heading = screen.getByRole('heading');
  const scroll = vi.fn();
  heading.scrollIntoView = scroll;
  await flush();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'instant' });
  expect(heading).toHaveFocus();
  expect(scrollTo).not.toHaveBeenCalled();
});

it('does not steal focus or scroll after the user starts interacting', async () => {
  renderRoute('/api-docs#authentication');
  const heading = screen.getByRole('heading');
  const scroll = vi.fn();
  heading.scrollIntoView = scroll;
  fireEvent.wheel(window);
  await flush();
  expect(scroll).not.toHaveBeenCalled();
  expect(heading).not.toHaveFocus();
});

it.each(['#missing', '#%E0%A4%A'])('ignores an unknown or malformed fragment %s', async (hash) => {
  renderRoute(`/api-docs${hash}`);
  await flush();
  expect(scrollTo).not.toHaveBeenCalled();
  expect(screen.getByRole('heading')).not.toHaveFocus();
});
