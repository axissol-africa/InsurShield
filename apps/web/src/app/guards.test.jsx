import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CustomerRoute, StaffRoute } from './guards';
import { DEMO_CUSTOMER_ACCOUNT, useStore } from '@/store';

const initial = useStore.getInitialState();
beforeEach(() => useStore.setState({ ...initial, registeredAccounts: [DEMO_CUSTOMER_ACCOUNT] }, true));

function ShowLocation() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}{location.search}</p>;
}

const renderAt = (path, element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<ShowLocation />} />
        <Route path="/create-account" element={<ShowLocation />} />
        <Route path="/admin-login" element={<ShowLocation />} />
        <Route path={path.split('?')[0]} element={element} />
      </Routes>
    </MemoryRouter>,
  );

describe('CustomerRoute', () => {
  it('sends guests to the account page and preserves the destination', () => {
    renderAt('/quote-request?x=1', <CustomerRoute><p>secret</p></CustomerRoute>);
    expect(screen.getByTestId('location')).toHaveTextContent('/create-account?next=%2Fquote-request%3Fx%3D1');
  });

  it('renders the page for a signed-in customer with consent', () => {
    useStore.getState().authenticateCustomer(DEMO_CUSTOMER_ACCOUNT.email, DEMO_CUSTOMER_ACCOUNT.password);
    renderAt('/account', <CustomerRoute><p>secret</p></CustomerRoute>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });

  it('sends the customer home, not to login, when the session ends on the page', async () => {
    useStore.getState().authenticateCustomer(DEMO_CUSTOMER_ACCOUNT.email, DEMO_CUSTOMER_ACCOUNT.password);
    renderAt('/account', <CustomerRoute><p>secret</p></CustomerRoute>);
    await act(async () => { useStore.getState().signOut(); });
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
});

describe('StaffRoute', () => {
  it('redirects without a staff session', () => {
    renderAt('/admin', <StaffRoute roles={['admin']}><p>admin</p></StaffRoute>);
    expect(screen.getByTestId('location')).toHaveTextContent('/admin-login');
  });

  it('enforces the role', () => {
    useStore.getState().startStaffSession({ role: 'insurer', name: 'Prestige' });
    renderAt('/admin', <StaffRoute roles={['admin', 'support']}><p>admin</p></StaffRoute>);
    expect(screen.getByTestId('location')).toHaveTextContent('/admin-login');
  });

  it('renders for the right role', () => {
    useStore.getState().startStaffSession({ role: 'insurer', name: 'Prestige' });
    renderAt('/insurer', <StaffRoute roles={['insurer']}><p>portal</p></StaffRoute>);
    expect(screen.getByText('portal')).toBeInTheDocument();
  });
});
