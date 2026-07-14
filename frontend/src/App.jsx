import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MainLayout from './layout/MainLayout';
import LandingPage from './pages/LandingPage';
import PhoneVerificationPage from './pages/PhoneVerificationPage';
import VehicleIdentificationPage from './pages/VehicleIdentificationPage';
import VehicleUsagePage from './pages/VehicleUsagePage';
import InsuranceTypePage from './pages/InsuranceTypePage';
import InsuranceCompaniesSelectionPage from './pages/InsuranceCompaniesSelectionPage';
import QuoteRequestFormPage from './pages/QuoteRequestFormPage';
import FinalizeQuoteRequestPage from './pages/FinalizeQuoteRequestPage';
import WaitingScreen from './pages/WaitingScreen';
import QuotesComparisonPage from './pages/QuotesComparisonPage';
import PaymentPage from './pages/PaymentPage';
import PolicyConfirmationPage from './pages/PolicyConfirmationPage';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import InsurerDashboard from './pages/InsurerDashboard';
import RenewalPage from './pages/RenewalPage';
import TrackApplicationPage from './pages/TrackApplicationPage';
import ClaimsPage from './pages/ClaimsPage';
import QuoteRulesPage from './pages/QuoteRulesPage';
import SupportPage from './pages/SupportPage';
import InspectionWorkflowPage from './pages/InspectionWorkflowPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<LandingPage />} />
          <Route path="track" element={<TrackApplicationPage />} />
          <Route path="verify-phone" element={<PhoneVerificationPage />} />
          <Route path="vehicle-identification" element={<VehicleIdentificationPage />} />
          <Route path="vehicle-usage" element={<VehicleUsagePage />} />
          <Route path="insurance-type" element={<InsuranceTypePage />} />
          <Route path="select-insurers" element={<InsuranceCompaniesSelectionPage />} />
          <Route path="quote-form" element={<QuoteRequestFormPage />} />
          <Route path="finalize-request" element={<FinalizeQuoteRequestPage />} />
          <Route path="waiting" element={<WaitingScreen />} />
          <Route path="quotes-comparison" element={<QuotesComparisonPage />} />
          <Route path="payment" element={<PaymentPage />} />
          <Route path="confirmation" element={<PolicyConfirmationPage />} />
          <Route path="admin-login" element={<AdminLogin />} />
          <Route path="admin" element={<AdminDashboard />} />
          <Route path="insurer" element={<InsurerDashboard />} />
          <Route path="renewal" element={<RenewalPage />} />
          {/* Quote Rules Gate */}
          <Route path="quote-rules" element={<QuoteRulesPage />} />
          {/* New Routes — Sprint 2 & 3 */}
          <Route path="claims" element={<ClaimsPage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="inspections" element={<InspectionWorkflowPage />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
