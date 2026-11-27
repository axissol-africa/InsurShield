import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@/config/env', () => ({ env: { apiMode: 'http', isProduction: false } }));

import { CustomerRoute } from './guards';
import { useStore } from '@/store';

const initial = useStore.getInitialState();
beforeEach(() => useStore.setState({ ...initial, staffSession: { role: 'admin', name: 'Platform Admin' } }, true));

function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

it('sends a staff session that reaches a customer route to its portal', () => {
  render(
    <MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route path="/account" element={<CustomerRoute><p>customer data</p></CustomerRoute>} />
        <Route path="/admin" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(screen.getByTestId('location')).toHaveTextContent('/admin');
  expect(screen.queryByText('customer data')).not.toBeInTheDocument();
});

it('never treats a capture query as authentication in HTTP mode', () => {
  useStore.setState({ staffSession: null, isAuthenticated: false, consentAccepted: false });
  render(
    <MemoryRouter initialEntries={['/quote-request?capture=untrusted']}>
      <Routes>
        <Route path="/quote-request" element={<CustomerRoute><p>customer data</p></CustomerRoute>} />
        <Route path="/create-account" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.queryByText('customer data')).not.toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('/create-account');
});
