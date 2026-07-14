import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';

const QUOTE_RULES = [
  {
    icon: 'fact_check',
    title: 'Accurate Registration Information',
    rule: 'I confirm that all vehicle registration details I have provided (plate number, chassis number, engine number, make, model and year) are accurate and match the official RTSA records. Any discrepancy may invalidate a claim.',
  },
  {
    icon: 'person_check',
    title: 'Authorised Representative',
    rule: 'I confirm that I am either the registered owner of this vehicle or am duly authorised in writing to arrange insurance on behalf of the registered owner. Arranging insurance without authority is a criminal offence under Zambian law.',
  },
  {
    icon: 'car_crash',
    title: 'No Undisclosed Defects or Prior Damage',
    rule: 'I confirm that this vehicle has no significant mechanical defects, structural damage, or prior unrepaired accident damage that I have not already disclosed. Failure to disclose material facts is a ground for policy cancellation and claim rejection.',
  },
  {
    icon: 'history',
    title: 'Previous Insurance History Disclosure',
    rule: 'I confirm that I have not had any insurance policy cancelled, voided, or refused by any insurer in the past 3 years without disclosing this to InsurShield. Non-disclosure of prior cancellations is a material misrepresentation.',
  },
  {
    icon: 'discount',
    title: 'NCD Code Authenticity',
    rule: 'If I am applying a No Claim Discount (NCD) code, I confirm that the code was legitimately issued to me by the stated insurer for this specific vehicle. I understand the code is single-use and valid only with the issuing insurer. Fraudulent use of NCD codes will result in immediate policy cancellation.',
  },
  {
    icon: 'privacy_tip',
    title: 'Data Sharing & POPIA Consent',
    rule: 'I consent to InsurShield sharing my personal information and vehicle details with the insurance companies I have selected for the purpose of generating quotations. This data sharing is governed by the InsurShield Privacy Policy and the Protection of Personal Information Act (POPIA).',
  },
];

export default function QuoteRulesPage() {
  const navigate = useNavigate();
  const { setQuoteRulesAgreed, vehicleDetails, vehicleValue } = useStore();
  const [checkedItems, setCheckedItems] = useState({});
  const [attempted, setAttempted] = useState(false);

  const allChecked = QUOTE_RULES.every((_, idx) => checkedItems[idx]);

  const toggleItem = (idx) => {
    setCheckedItems(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleAgree = () => {
    if (!allChecked) {
      setAttempted(true);
      return;
    }
    setQuoteRulesAgreed(true);
    navigate('/select-insurers');
  };

  const uncheckedCount = QUOTE_RULES.filter((_, idx) => !checkedItems[idx]).length;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto px-4 py-10 pb-32">

      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-primary text-3xl">gavel</span>
        </div>
        <h1 className="text-[28px] font-bold text-primary mb-2">Declaration & Rules</h1>
        <p className="text-[15px] text-on-surface-variant max-w-lg mx-auto">
          Before requesting insurance quotations, you must read and individually agree to each of the following declarations. This protects you, the insurers, and the integrity of the platform.
        </p>
      </div>

      {/* Vehicle summary reminder */}
      {vehicleDetails && (
        <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 mb-6 flex items-center gap-4">
          <span className="material-symbols-outlined text-primary text-2xl">directions_car</span>
          <div>
            <p className="text-[13px] font-bold text-primary">{vehicleDetails.year} {vehicleDetails.make} {vehicleDetails.model} — {vehicleDetails.plateNumber}</p>
            <p className="text-[12px] text-on-surface-variant">
              Declared Value: <strong className="text-primary">{vehicleValue > 0 ? `ZMW ${vehicleValue.toLocaleString()}` : 'Not set'}</strong>
              {vehicleDetails.chassisNumber && ` · Chassis: ${vehicleDetails.chassisNumber}`}
            </p>
          </div>
        </div>
      )}

      {/* Progress indicator */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] text-on-surface-variant">
          <strong className="text-primary">{QUOTE_RULES.length - uncheckedCount}</strong> of {QUOTE_RULES.length} declarations acknowledged
        </p>
        <div className="flex gap-1">
          {QUOTE_RULES.map((_, i) => (
            <div key={i} className={`w-2.5 h-2.5 rounded-full transition-colors ${checkedItems[i] ? 'bg-primary' : 'bg-gray-200'}`} />
          ))}
        </div>
      </div>

      {/* Rules */}
      <div className="space-y-3 mb-6">
        {QUOTE_RULES.map((item, idx) => {
          const isChecked = checkedItems[idx];
          const isUncheckedWarning = attempted && !isChecked;

          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              onClick={() => toggleItem(idx)}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all select-none ${
                isChecked
                  ? 'bg-green-50 border-green-400'
                  : isUncheckedWarning
                  ? 'bg-red-50 border-red-300 animate-pulse-once'
                  : 'bg-white border-gray-200 hover:border-primary/40 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Custom Checkbox */}
                <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all ${
                  isChecked ? 'bg-green-500 border-green-500' : isUncheckedWarning ? 'border-red-400' : 'border-gray-300'
                }`}>
                  {isChecked && <span className="material-symbols-outlined text-white text-[14px]">check</span>}
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`material-symbols-outlined text-[16px] ${isChecked ? 'text-green-700' : 'text-secondary'}`}>{item.icon}</span>
                    <p className={`text-[14px] font-bold ${isChecked ? 'text-green-900' : 'text-on-surface'}`}>{item.title}</p>
                    <span className="ml-auto text-[11px] font-bold text-secondary">{idx + 1}/{QUOTE_RULES.length}</span>
                  </div>
                  <p className={`text-[13px] leading-relaxed ${isChecked ? 'text-green-800' : 'text-on-surface-variant'}`}>
                    {item.rule}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {attempted && !allChecked && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-red-50 border-2 border-red-300 rounded-xl p-4 mb-4 flex items-center gap-3"
        >
          <span className="material-symbols-outlined text-red-600 text-xl">error</span>
          <p className="text-[13px] font-semibold text-red-900">
            You must acknowledge all {QUOTE_RULES.length} declarations before proceeding. <strong>{uncheckedCount}</strong> remaining.
          </p>
        </motion.div>
      )}

      {/* Legal Notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-700 text-xl">balance</span>
          <div>
            <p className="text-[13px] font-bold text-amber-900">Legal Notice</p>
            <p className="text-[12px] text-amber-800 mt-1">
              By proceeding, you are making legally binding declarations under Zambian insurance law. False declarations may constitute insurance fraud and are prosecutable under the Penal Code Act (Chapter 87) and the Insurance Act of Zambia. InsurShield is regulated by the Pensions and Insurance Authority (PIA) of Zambia and is required to report suspected fraud.
            </p>
          </div>
        </div>
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-16 md:bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-xl p-4 z-40">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="flex-1">
            <p className="text-[12px] font-bold text-secondary">
              {allChecked
                ? '✅ All declarations acknowledged'
                : `⚠️ ${uncheckedCount} declaration${uncheckedCount !== 1 ? 's' : ''} remaining`
              }
            </p>
            <p className="text-[11px] text-on-surface-variant">Click each item above to acknowledge</p>
          </div>
          <button
            onClick={handleAgree}
            className={`px-8 py-4 rounded-xl font-bold text-[15px] transition-all active:scale-[0.98] flex items-center gap-2 ${
              allChecked
                ? 'bg-primary text-white shadow-lg shadow-primary/25 hover:bg-primary-container'
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{allChecked ? 'verified' : 'lock'}</span>
            {allChecked ? 'Proceed to Compare Insurers' : `${uncheckedCount} Left`}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
