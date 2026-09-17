import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layout/MainLayout';
import { CustomerRoute, StaffRoute } from './components/ProtectedRoute';
import LandingPage from './pages/LandingPage';
import CreateAccountPage from './pages/CreateAccountPage';
import InsuranceTypePage from './pages/InsuranceTypePage';
import VehicleIdentificationPage from './pages/VehicleIdentificationPage';
import VehicleUsagePage from './pages/VehicleUsagePage';
import QuoteRequestPage from './pages/QuoteRequestPage';
import QuotesComparisonPage from './pages/QuotesComparisonPage';
import PaymentPage from './pages/PaymentPage';
import PolicyConfirmationPage from './pages/PolicyConfirmationPage';
import CustomerAccountPage from './pages/CustomerAccountPage';
import RenewalPage from './pages/RenewalPage';
import ClaimsPage from './pages/ClaimsPage';
import SupportPage from './pages/SupportPage';
import InspectionWorkflowPage from './pages/InspectionWorkflowPage';
import CapturePage from './pages/CapturePage';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import InsurerDashboard from './pages/InsurerDashboard';

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
