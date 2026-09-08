import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layout/MainLayout';
import LandingPage from './pages/LandingPage';
import PhoneVerificationPage from './pages/PhoneVerificationPage';
import CreateAccountPage from './pages/CreateAccountPage';
import VehicleIdentificationPage from './pages/VehicleIdentificationPage';
import VehicleUsagePage from './pages/VehicleUsagePage';
import InsuranceTypePage from './pages/InsuranceTypePage';
import InsuranceCompaniesSelectionPage from './pages/InsuranceCompaniesSelectionPage';
import QuotesComparisonPage from './pages/QuotesComparisonPage';
import PaymentPage from './pages/PaymentPage';
import PolicyConfirmationPage from './pages/PolicyConfirmationPage';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import InsurerDashboard from './pages/InsurerDashboard';
import RenewalPage from './pages/RenewalPage';
import ClaimsPage from './pages/ClaimsPage';
import SupportPage from './pages/SupportPage';
import InspectionWorkflowPage from './pages/InspectionWorkflowPage';
import CustomerAccountPage from './pages/CustomerAccountPage';
import ProtectedQuoteRoute from './components/ProtectedQuoteRoute';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<LandingPage />} />
          <Route path="track" element={<Navigate to="/claims" replace />} />
          <Route path="verify-phone" element={<PhoneVerificationPage />} />
          <Route path="create-account" element={<CreateAccountPage />} />
          <Route path="vehicle-identification" element={<VehicleIdentificationPage />} />
          <Route path="vehicle-usage" element={<VehicleUsagePage />} />
          <Route path="insurance-type" element={<InsuranceTypePage />} />
          <Route path="select-insurers" element={<ProtectedQuoteRoute><InsuranceCompaniesSelectionPage /></ProtectedQuoteRoute>} />
          <Route path="quote-form" element={<Navigate to="/select-insurers" replace />} />
          <Route path="finalize-request" element={<Navigate to="/select-insurers" replace />} />
          <Route path="waiting" element={<Navigate to="/quotes-comparison" replace />} />
          <Route path="quotes-comparison" element={<QuotesComparisonPage />} />
          <Route path="payment" element={<PaymentPage />} />
          <Route path="confirmation" element={<PolicyConfirmationPage />} />
          <Route path="account" element={<ProtectedQuoteRoute><CustomerAccountPage /></ProtectedQuoteRoute>} />
          <Route path="admin-login" element={<AdminLogin />} />
          <Route path="admin" element={<AdminDashboard />} />
          <Route path="insurer" element={<InsurerDashboard />} />
          <Route path="renewal" element={<ProtectedQuoteRoute><RenewalPage /></ProtectedQuoteRoute>} />
          <Route path="quote-rules" element={<Navigate to="/select-insurers" replace />} />
          {/* New Routes — Sprint 2 & 3 */}
          <Route path="claims" element={<ProtectedQuoteRoute><ClaimsPage /></ProtectedQuoteRoute>} />
          <Route path="support" element={<SupportPage />} />
          <Route path="inspections" element={<InspectionWorkflowPage />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
