import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store/useStore';

const PRIVACY_TEXT = `
InsurShield Privacy Policy — Last Updated: January 2025

1. DATA CONTROLLER
InsurShield Aggregator Ltd. ("InsurShield", "we", "us") is registered in Zambia and regulated by the Pensions and Insurance Authority (PIA).

2. DATA WE COLLECT
We collect: full name, NRC number, phone number, email address, vehicle details (registration, chassis number, engine number, make, model, year, value), insurance history, claim history, payment information, and device/browser data for fraud prevention.

3. PURPOSE OF PROCESSING
• Generating insurance quotations
• Policy issuance and management
• Claims processing
• Regulatory compliance (PIA, PICZ, RTSA)
• Customer support
• Marketing communications (with your consent)

4. DATA SHARING
We share your data with: selected insurance companies (for quote generation), RTSA (vehicle verification), PIA (regulatory reporting), payment processors, and fraud prevention services. We do not sell your personal data.

5. DATA RETENTION
We retain personal data for 7 years following policy expiry, or as required by PIA regulations.

6. YOUR RIGHTS (POPIA)
Under the Protection of Personal Information Act (POPIA), you have the right to: access your data, correct inaccurate data, delete your data (subject to regulatory requirements), object to processing, and lodge a complaint with the Information Regulator.

7. DATA SECURITY
All data is encrypted in transit (TLS 1.3) and at rest. We use bank-grade security protocols and conduct annual security audits.

8. CONTACT
Data Protection Officer: privacy@insurshield.zm | +260 978 000 001
`;

const TERMS_TEXT = `
InsurShield Terms & Conditions — Last Updated: January 2025

1. ACCEPTANCE
By using InsurShield, you agree to these Terms. If you do not agree, do not use our platform.

2. SERVICE DESCRIPTION
InsurShield is an insurance aggregation platform that facilitates connections between insurance seekers and licensed insurance companies in Zambia. We are not an insurance company.

3. YOUR OBLIGATIONS
• Provide accurate and truthful information
• Notify us of any changes to vehicle or personal details
• Not use our platform for fraudulent purposes
• Pay premiums on time once a policy is accepted

4. QUOTATION PROCESS
Quotations are indicative and subject to insurer acceptance. InsurShield does not guarantee acceptance by any insurer.

5. PREMIUM CALCULATIONS
Premiums are calculated based on vehicle value, insurer rates, and regulatory minimums set by the Pensions and Insurance Authority (PIA). The PIA minimum premium applies at all times.

6. CLAIMS
Claims are processed by the relevant insurer. InsurShield facilitates communication but does not make claims decisions.

7. LIMITATION OF LIABILITY
InsurShield's liability is limited to the platform service fee paid. We are not liable for insurer decisions, claim outcomes, or force majeure events.

8. GOVERNING LAW
These Terms are governed by the laws of the Republic of Zambia.
`;

export default function ConsentModal({ onAccept, onDecline, trigger = 'registration' }) {
  const { consentAccepted, setConsent } = useStore();
  const [activeTab, setActiveTab] = useState('privacy'); // 'privacy' | 'terms'
  const [privacyScrolled, setPrivacyScrolled] = useState(false);
  const [termsScrolled, setTermsScrolled] = useState(false);
  const [bothAccepted, setBothAccepted] = useState(false);
  const [checked, setChecked] = useState({ privacy: false, terms: false });

  const handleScroll = (e, type) => {
    const el = e.target;
    const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 20;
    if (isAtBottom) {
      if (type === 'privacy') setPrivacyScrolled(true);
      if (type === 'terms') setTermsScrolled(true);
    }
  };

  const handleAccept = () => {
    setConsent(true);
    if (onAccept) onAccept();
  };

  const triggerLabels = {
    registration: 'Before accessing InsurShield, you must review and accept our policies.',
    quotation: 'Before requesting insurance quotes, please review and accept our data usage policies.',
    payment: 'Before completing your payment, please confirm your consent to our terms.',
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="bg-primary p-5 text-white flex-shrink-0">
            <div className="flex items-center gap-3 mb-2">
              <span className="material-symbols-outlined text-2xl">security</span>
              <h2 className="text-[20px] font-bold">Privacy & Terms</h2>
            </div>
            <p className="text-[13px] text-white/80">{triggerLabels[trigger] || triggerLabels.registration}</p>
            <div className="flex items-center gap-2 mt-2 bg-white/10 rounded-lg px-3 py-1.5">
              <span className="material-symbols-outlined text-[14px]">gavel</span>
              <span className="text-[11px] font-semibold">POPIA Compliant · PIA Regulated</span>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-100 flex-shrink-0">
            {[
              { id: 'privacy', label: 'Privacy Policy', scrolled: privacyScrolled },
              { id: 'terms', label: 'Terms & Conditions', scrolled: termsScrolled },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3 text-[13px] font-bold transition-colors flex items-center justify-center gap-2 ${activeTab === tab.id ? 'text-primary border-b-2 border-primary' : 'text-secondary hover:text-primary'}`}
              >
                {tab.scrolled && <span className="material-symbols-outlined text-green-600 text-[14px]">check_circle</span>}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div
            className="flex-1 overflow-y-auto p-5 text-[13px] text-on-surface leading-relaxed whitespace-pre-line"
            onScroll={e => handleScroll(e, activeTab)}
          >
            {activeTab === 'privacy' ? PRIVACY_TEXT : TERMS_TEXT}
            {!((activeTab === 'privacy' ? privacyScrolled : termsScrolled)) && (
              <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-white to-transparent h-12 flex items-end justify-center pb-1">
                <p className="text-[11px] text-secondary animate-bounce">↓ Scroll to read</p>
              </div>
            )}
          </div>

          {/* Consent Checkboxes */}
          <div className="p-4 border-t border-gray-100 space-y-3 flex-shrink-0 bg-surface-container-low">
            {[
              { id: 'privacy', label: 'I have read and agree to the Privacy Policy and consent to the processing of my personal data as described.' },
              { id: 'terms', label: 'I have read and agree to the Terms & Conditions of InsurShield.' },
            ].map(item => (
              <div key={item.id} className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${checked[item.id] ? 'bg-green-50 border border-green-200' : 'bg-white border border-gray-200 hover:border-primary/30'}`} onClick={() => setChecked(prev => ({ ...prev, [item.id]: !prev[item.id] }))}>
                <input type="checkbox" checked={checked[item.id]} onChange={() => {}} className="w-5 h-5 mt-0.5 rounded text-primary focus:ring-primary flex-shrink-0 cursor-pointer" />
                <span className="text-[12px] text-on-surface">{item.label}</span>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="p-4 flex gap-3 flex-shrink-0 bg-white border-t border-gray-100">
            <button onClick={onDecline} className="flex-1 py-3 border-2 border-gray-200 text-on-surface-variant font-semibold rounded-xl hover:bg-gray-50 transition-colors text-[14px]">
              Decline
            </button>
            <button
              onClick={handleAccept}
              disabled={!checked.privacy || !checked.terms}
              className="flex-[2] py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary-container transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-[14px] flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">verified</span>
              Accept & Continue
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
