import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { CustomerRoute, StaffRoute } from './guards';
import LandingPage from '@/features/home/pages/LandingPage';
import CreateAccountPage from '@/features/auth/pages/CreateAccountPage';
import InsuranceTypePage from '@/features/quote-journey/pages/InsuranceTypePage';
import VehicleIdentificationPage from '@/features/quote-journey/pages/VehicleIdentificationPage';
import VehicleUsagePage from '@/features/quote-journey/pages/VehicleUsagePage';
import QuoteRequestPage from '@/features/quote-journey/pages/QuoteRequestPage';
import QuotesComparisonPage from '@/features/quote-journey/pages/QuotesComparisonPage';
import PaymentPage from '@/features/payment/pages/PaymentPage';
import PolicyConfirmationPage from '@/features/payment/pages/PolicyConfirmationPage';
import CustomerAccountPage from '@/features/account/pages/CustomerAccountPage';
import RenewalPage from '@/features/policies/pages/RenewalPage';
import ClaimsPage from '@/features/claims/pages/ClaimsPage';
import SupportPage from '@/features/support/pages/SupportPage';
import InspectionWorkflowPage from '@/features/inspections/pages/InspectionWorkflowPage';
import CapturePage from '@/features/quote-journey/pages/CapturePage';
import AdminLogin from '@/features/auth/pages/StaffLoginPage';
import AdminDashboard from '@/features/admin/pages/AdminDashboard';
import InsurerDashboard from '@/features/insurer-portal/pages/InsurerDashboard';

const customerOnly = (page) => <CustomerRoute>{page}</CustomerRoute>;

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          {/* Public: guests can explore and prepare a quote */}
          <Route index element={<LandingPage />} />
          <Route path="create-account" element={<CreateAccountPage />} />
          <Route path="insurance-type" element={<InsuranceTypePage />} />
          <Route path="vehicle-identification" element={<VehicleIdentificationPage />} />
          <Route path="vehicle-usage" element={<VehicleUsagePage />} />
          <Route path="support" element={<SupportPage />} />
          {/* Phone side of the photo hand-off; the session code is the authorisation */}
          <Route path="capture/:code" element={<CapturePage />} />

          {/* Customer account required from the quote request onwards */}
          <Route path="quote-request" element={customerOnly(<QuoteRequestPage />)} />
          <Route path="quotes-comparison" element={customerOnly(<QuotesComparisonPage />)} />
          <Route path="payment" element={customerOnly(<PaymentPage />)} />
          <Route path="confirmation" element={customerOnly(<PolicyConfirmationPage />)} />
          <Route path="account" element={customerOnly(<CustomerAccountPage />)} />
          <Route path="renewal" element={customerOnly(<RenewalPage />)} />
          <Route path="claims" element={customerOnly(<ClaimsPage />)} />
          <Route path="inspections" element={customerOnly(<InspectionWorkflowPage />)} />

          {/* Staff and insurer portals */}
          <Route path="admin-login" element={<AdminLogin />} />
          <Route path="admin" element={<StaffRoute roles={['admin', 'support']}><AdminDashboard /></StaffRoute>} />
          <Route path="insurer" element={<StaffRoute roles={['insurer']}><InsurerDashboard /></StaffRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}
