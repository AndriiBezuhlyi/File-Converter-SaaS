import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { AppProviders } from './AppProviders';

describe('application bootstrap', () => {
  it('mounts the React shell with router and query providers', () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>,
    );
    expect(screen.getByRole('main', { name: 'File Converter' })).toBeInTheDocument();
  });
});
