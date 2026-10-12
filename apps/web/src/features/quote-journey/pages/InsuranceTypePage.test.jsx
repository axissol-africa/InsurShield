import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store';
import InsuranceTypePage from './InsuranceTypePage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/insurance-type']}>
      <Routes>
        <Route path="/insurance-type" element={<InsuranceTypePage />} />
        <Route path="/vehicle-identification" element={<h1>Vehicle identification</h1>} />
        <Route path="/" element={<h1>Home</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useStore.setState({ insuranceType: null });
  // Radix measures the hidden form input; jsdom does not provide layout observers.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('insurance type selection', () => {
  it('defaults to comprehensive and saves it on Continue', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('radio', { name: 'Comprehensive' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(useStore.getState().insuranceType).toBe('Comprehensive');
    expect(screen.getByRole('heading', { name: 'Vehicle identification' })).toBeInTheDocument();
  });

  it('saves third party only when the customer continues', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Third party only' }));
    expect(screen.getByRole('radio', { name: 'Third party only' })).toBeChecked();
    expect(useStore.getState().insuranceType).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(useStore.getState().insuranceType).toBe('ThirdParty');
    expect(screen.getByRole('heading', { name: 'Vehicle identification' })).toBeInTheDocument();
  });

  it('supports arrow-key selection without submitting the form', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Comprehensive' })).toHaveFocus();
    await user.keyboard('{ArrowRight>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Third party only' })).toBeChecked());
    await user.keyboard('{/ArrowRight}');
    expect(useStore.getState().insuranceType).toBeNull();
    expect(screen.getByRole('heading', { name: 'Choose your cover' })).toBeInTheDocument();
  });

  it('restores the saved cover and keeps Back linked to home', async () => {
    useStore.setState({ insuranceType: 'ThirdParty' });
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('radio', { name: 'Third party only' })).toBeChecked();
    await user.click(screen.getByRole('link', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});
