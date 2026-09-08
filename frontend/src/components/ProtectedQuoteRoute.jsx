import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';

export default function ProtectedQuoteRoute({ children }) {
  const location = useLocation();
  const { isAuthenticated, consentAccepted } = useStore();

  if (!isAuthenticated || !consentAccepted) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/create-account?next=${encodeURIComponent(next)}`} replace />;
  }

  return children;
}
