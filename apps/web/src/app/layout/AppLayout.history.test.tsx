import { fireEvent, render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';

it('starts an unrendered history destination at the top after an interrupted transition', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  function HistoryControls() {
    const navigate = useNavigate();
    return <button onClick={() => void navigate(1)}>Forward</button>;
  }
  const view = render(
    <MemoryRouter initialEntries={['/api-docs', '/']} initialIndex={0}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="api-docs" element={<HistoryControls />} />
          <Route path="/" element={<h1>Converter</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Converter' })).toBeInTheDocument();
    expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  } finally {
    view.unmount();
    frame.mockRestore();
    scroll.mockRestore();
  }
});
