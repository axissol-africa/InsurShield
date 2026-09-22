import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '@/store';

/**
 * Gate for customer-only pages (quote request, comparison, payment, account,
 * claims, renewals). Guests are sent to the account screen with the intended
 * destination preserved so they return exactly where they left off.
 *
 * If the session ends while one of these pages is open (sign out, account
 * removal) the customer is sent home rather than to the login screen.
 */
export function CustomerRoute({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, consentAccepted } = useStore();
  const allowed = isAuthenticated && consentAccepted;
  const [hadAccessOnMount] = useState(allowed);

  useEffect(() => {
    if (hadAccessOnMount && !allowed) navigate('/', { replace: true });
  }, [allowed, hadAccessOnMount, navigate]);

  if (allowed) return children;
  if (hadAccessOnMount) return null;

  const next = `${location.pathname}${location.search}`;
  return <Navigate to={`/create-account?next=${encodeURIComponent(next)}`} replace state={{ reason: 'account-required' }} />;
}

/** Gate for the staff and insurer portals. */
export function StaffRoute({ children, roles }) {
  const { staffSession } = useStore();
  if (staffSession && (!roles || roles.includes(staffSession.role))) return children;
  return <Navigate to="/admin-login" replace />;
}
