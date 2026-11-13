import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StaffLoginPage from './StaffLoginPage';
import { api } from '@/api';
import { adoptOwnIdentity } from '@/app/identity';

vi.mock('@/config/env', () => ({ env: { apiMode: 'http' } }));

vi.mock('@/api', () => ({
  api: {
    auth: {
      signIn: vi.fn(),
      sendStaffMfaCode: vi.fn(),
      verifyStaffMfaCode: vi.fn(),
      me: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('@/app/identity', () => ({
  adoptOwnIdentity: vi.fn(),
  requestIdentityTransition: vi.fn(),
}));

describe('staff login with email MFA', () => {
  it('requires and verifies an email code before navigating to the staff workspace', async () => {
    api.auth.signIn.mockResolvedValue({ twoFactorRedirect: true, twoFactorMethods: ['otp'] });
    api.auth.sendStaffMfaCode.mockResolvedValue({ ok: true });
    api.auth.verifyStaffMfaCode.mockResolvedValue({ user: { id: 'staff-1' } });
    api.auth.me.mockResolvedValue({ userId: 'staff-1', staffSession: { role: 'admin' } });
    adoptOwnIdentity.mockReturnValue({ transitioned: false });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/admin-login']}>
        <Routes>
          <Route path="/admin-login" element={<StaffLoginPage />} />
          <Route path="/admin" element={<h1>Admin home</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email address'), 'admin@insurshield.zm');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Continue to administrator' }));

    expect(api.auth.signIn).toHaveBeenCalledWith('admin@insurshield.zm', 'correct-password');
    expect(api.auth.sendStaffMfaCode).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Email code required')).toBeVisible();
    expect(screen.getByLabelText('Six-digit code')).toBeVisible();

    await user.type(screen.getByLabelText('Six-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(api.auth.verifyStaffMfaCode).toHaveBeenCalledWith('123456');
    expect(adoptOwnIdentity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'staff-1',
      landing: '/admin-login',
    }));
    expect(await screen.findByRole('heading', { name: 'Admin home' })).toBeVisible();
  });
});
