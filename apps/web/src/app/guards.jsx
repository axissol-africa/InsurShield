import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '@/store';
import { env } from '@/config/env';

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
  // The QR capture code is a short-lived bearer credential in the local demo
  // relay. It lets a customer finish the same journey on their phone without
  // requiring a second local browser account. This is intentionally disabled
  // for production, where the backend must validate a signed resume token.
  const captureContinuation = !env.isProduction && new URLSearchParams(location.search).has('capture');
  const allowed = (isAuthenticated && consentAccepted) || captureContinuation;
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
