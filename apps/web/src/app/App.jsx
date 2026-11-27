import { lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { CustomerRoute, StaffRoute } from './guards';
import IdentitySessionBoundary from './IdentitySessionBoundary';
import RouteContent from './RouteContent';
function publicEntry(path, load) {
  if (!import.meta.env.PROD || (window.location.pathname.replace(/\/+$/, '') || '/') !== path) return lazy(load);
  // The matching page can download while the session check runs. Keep any
  // rejection for the route boundary when React attempts to render it.
  const entry = load();
  void entry.catch(() => undefined);
  return lazy(() => entry);
}

const LandingPage = publicEntry('/', () => import('@/features/home/pages/LandingPage'));
const InsuranceTypePage = publicEntry('/insurance-type', () => import('@/features/quote-journey/pages/InsuranceTypePage'));
const SupportPage = publicEntry('/support', () => import('@/features/support/pages/SupportPage'));

const CreateAccountPage = lazy(() => import('@/features/auth/pages/CreateAccountPage'));
const ResetPasswordPage = lazy(() => import('@/features/auth/pages/ResetPasswordPage'));
const VehicleIdentificationPage = lazy(() => import('@/features/quote-journey/pages/VehicleIdentificationPage'));
const VehicleUsagePage = lazy(() => import('@/features/quote-journey/pages/VehicleUsagePage'));
const QuoteRequestPage = lazy(() => import('@/features/quote-journey/pages/QuoteRequestPage'));
const QuotesComparisonPage = lazy(() => import('@/features/quote-journey/pages/QuotesComparisonPage'));
const PaymentPage = lazy(() => import('@/features/payment/pages/PaymentPage'));
const PolicyConfirmationPage = lazy(() => import('@/features/payment/pages/PolicyConfirmationPage'));
const CustomerAccountPage = lazy(() => import('@/features/account/pages/CustomerAccountPage'));
const NotificationCentrePage = lazy(() => import('@/features/notifications/pages/NotificationCentrePage'));
const RenewalPage = lazy(() => import('@/features/policies/pages/RenewalPage'));
const ClaimsPage = lazy(() => import('@/features/claims/pages/ClaimsPage'));
const InsurerProfilePage = lazy(() => import('@/features/reviews/pages/InsurerProfilePage'));
const ServiceRequestsPage = lazy(() => import('@/features/service-requests/pages/ServiceRequestsPage'));
const NewServiceRequestPage = lazy(() => import('@/features/service-requests/pages/NewServiceRequestPage'));
const ServiceRequestPage = lazy(() => import('@/features/service-requests/pages/ServiceRequestPage'));
const InspectionWorkflowPage = lazy(() => import('@/features/inspections/pages/InspectionWorkflowPage'));
const CapturePage = lazy(() => import('@/features/quote-journey/pages/CapturePage'));
const AdminLogin = lazy(() => import('@/features/auth/pages/StaffLoginPage'));
const AdminDashboard = lazy(() => import('@/features/admin/pages/AdminDashboard'));
const InsurerDashboard = lazy(() => import('@/features/insurer-portal/pages/InsurerDashboard'));

const customerOnly = (page) => <CustomerRoute>{page}</CustomerRoute>;

export default function App() {
  return (
    <Router>
      <IdentitySessionBoundary>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          {/* Public: guests can explore and prepare a quote */}
          <Route index element={<LandingPage />} />
          <Route path="create-account" element={<CreateAccountPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="insurance-type" element={<InsuranceTypePage />} />
          <Route path="vehicle-identification" element={<VehicleIdentificationPage />} />
          <Route path="vehicle-usage" element={<VehicleUsagePage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="insurers/:insurerId" element={<InsurerProfilePage />} />
          {/* Phone side of the photo hand-off; the session code is the authorisation */}
          <Route path="capture/:code" element={<CapturePage />} />

          {/* Customer account required from the quote request onwards */}
          <Route path="quote-request" element={customerOnly(<QuoteRequestPage />)} />
          <Route path="quotes-comparison" element={customerOnly(<QuotesComparisonPage />)} />
          <Route path="payment" element={customerOnly(<PaymentPage />)} />
          <Route path="confirmation" element={customerOnly(<PolicyConfirmationPage />)} />
          <Route path="account" element={customerOnly(<CustomerAccountPage />)} />
          <Route path="notifications" element={customerOnly(<NotificationCentrePage />)} />
          <Route path="renewal" element={customerOnly(<RenewalPage />)} />
          <Route path="claims" element={customerOnly(<ClaimsPage />)} />
          <Route path="inspections" element={customerOnly(<InspectionWorkflowPage />)} />
          <Route path="service-requests" element={customerOnly(<ServiceRequestsPage />)} />
          <Route path="service-requests/new" element={customerOnly(<NewServiceRequestPage />)} />
          <Route path="service-requests/:reference" element={customerOnly(<ServiceRequestPage />)} />

          {/* Staff and insurer portals */}
          <Route path="admin-login" element={<AdminLogin />} />
          <Route path="admin" element={<StaffRoute roles={['admin']}><AdminDashboard /></StaffRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        <Route path="/insurer" element={<RouteContent><StaffRoute roles={['insurer']}><InsurerDashboard /></StaffRoute></RouteContent>} />
      </Routes>
      </IdentitySessionBoundary>
    </Router>
  );
}
