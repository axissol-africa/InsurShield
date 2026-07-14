import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';
import { formatZMW } from '../utils/premiumEngine';

export default function PolicyConfirmationPage() {
  const navigate = useNavigate();
  const { userPhone, vehicleDetails, vehicleValue, premiumBreakdown, policyDates, selectedQuote, resetStore, markNcdCodeUsed, ncdCodeValidated } = useStore();

  const [isGenerating, setIsGenerating] = React.useState(true);
  const policyNumber = React.useMemo(() => `POL-${Math.floor(100000 + Math.random() * 900000)}`, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setIsGenerating(false);
      // Mark NCD code as used — single use, cannot be applied again
      if (ncdCodeValidated) markNcdCodeUsed();
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const handleFinish = () => {
    resetStore();
    navigate('/');
  };

  const today = new Date().toLocaleDateString('en-ZM', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col items-center py-12 px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg space-y-5">

        {isGenerating ? (
          <div className="text-center space-y-6 py-16 bg-white rounded-2xl shadow-sm border border-gray-100">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto border-4 border-primary border-t-transparent"
            />
            <div>
              <h2 className="text-[24px] font-bold text-primary mb-2">Payment Confirmed!</h2>
              <p className="text-[14px] text-on-surface-variant px-6">
                The insurer is generating your official policy documents. We'll email and SMS you the PDF once ready.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-800 px-4 py-2 rounded-full text-[12px] font-bold">
              <span className="material-symbols-outlined text-[16px] animate-pulse">hourglass_top</span>
              AWAITING INSURER API
            </div>
          </div>
        ) : (
          <>
            {/* Success Header */}
            <div className="text-center space-y-2">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4"
              >
                <span className="material-symbols-outlined text-green-500 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
              </motion.div>
              <h2 className="text-[28px] font-bold text-primary">You're Covered!</h2>
              <p className="text-[14px] text-on-surface-variant">Your policy is now active. A copy has been sent to your email.</p>
            </div>

            {/* Policy Certificate */}
            <div className="bg-white rounded-2xl shadow-sm border-t-4 border-t-primary border-x border-b border-gray-100 relative overflow-hidden">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[6rem] font-black text-gray-50/40 -rotate-12 pointer-events-none select-none z-0">INSURSHIELD</div>

              <div className="p-5 relative z-10 border-b border-gray-100 bg-surface-container-low flex items-center justify-between">
                <div>
                  <h3 className="text-[17px] font-bold text-primary">Policy Certificate</h3>
                  <div className="text-[12px] font-bold tracking-[0.05em] text-secondary mt-0.5">{policyNumber}</div>
                </div>
                <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider">Active</div>
              </div>

              <div className="p-5 space-y-5 relative z-10">
                {/* Basic Policy Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[11px] font-bold tracking-[0.05em] text-on-surface-variant block uppercase mb-1">Insured Phone</span>
                    <span className="text-[15px] font-semibold text-on-surface">{userPhone || '097XXXXXXX'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold tracking-[0.05em] text-on-surface-variant block uppercase mb-1">Vehicle Plate</span>
                    <span className="text-[15px] font-semibold text-primary tracking-widest">{vehicleDetails?.plateNumber || 'ABC 1234'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold tracking-[0.05em] text-on-surface-variant block uppercase mb-1">Vehicle</span>
                    <span className="text-[14px] font-semibold">{vehicleDetails ? `${vehicleDetails.year} ${vehicleDetails.make} ${vehicleDetails.model}` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold tracking-[0.05em] text-on-surface-variant block uppercase mb-1">Vehicle Value</span>
                    <span className="text-[14px] font-semibold text-primary">{vehicleValue > 0 ? formatZMW(vehicleValue) : '—'}</span>
                  </div>
                  {vehicleDetails?.chassisNumber && (
                    <div className="col-span-2">
                      <span className="text-[11px] font-bold tracking-[0.05em] text-on-surface-variant block uppercase mb-1">Chassis Number</span>
                      <span className="font-mono text-[13px] font-semibold">{vehicleDetails.chassisNumber}</span>
                    </div>
                  )}
                  {vehicleDetails?.engineNumber && (
                    <div className="col-span-2">
                      <span className="text-[11px] font-bold tracking-[0.05em] text-on-surface-variant block uppercase mb-1">Engine Number</span>
                      <span className="font-mono text-[13px] font-semibold">{vehicleDetails.engineNumber}</span>
                    </div>
                  )}
                </div>

                {/* Coverage Period */}
                {policyDates ? (
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
                    <p className="text-[12px] font-bold uppercase text-primary">Coverage Period</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-[11px] text-on-surface-variant uppercase font-bold block">Valid From</span>
                        <span className="text-[14px] font-semibold">{policyDates.formattedStart}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-on-surface-variant uppercase font-bold block">Valid Until</span>
                        <span className="text-[14px] font-semibold">{policyDates.formattedEnd}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-primary/10">
                      <div>
                        <span className="text-[11px] text-on-surface-variant uppercase font-bold block">Days Remaining</span>
                        <span className="text-[20px] font-extrabold text-primary">{policyDates.daysRemaining}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] text-amber-700 uppercase font-bold block">Renewal Reminder</span>
                        <span className="text-[13px] font-semibold text-amber-800">{policyDates.formattedReminder}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[11px] font-bold tracking-[0.05em] text-on-surface-variant block uppercase mb-1">Valid From</span>
                      <span className="text-[14px] font-semibold">{today}</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-bold tracking-[0.05em] text-on-surface-variant block uppercase mb-1">Valid Until</span>
                      <span className="text-[14px] font-semibold">{new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}

                {/* Premium Breakdown */}
                {premiumBreakdown && (
                  <div className="bg-surface-container-low rounded-xl p-4 space-y-2">
                    <p className="text-[12px] font-bold uppercase text-on-surface-variant mb-2">Premium Summary</p>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-on-surface-variant">Base Premium</span>
                      <span className="font-semibold">{formatZMW(premiumBreakdown.basePremium)}</span>
                    </div>
                    {premiumBreakdown.ncdDiscount > 0 && (
                      <div className="flex justify-between text-[13px] text-green-700">
                        <span>NCD Discount ({premiumBreakdown.appliedNcdPercentage}%)</span>
                        <span className="font-semibold">- {formatZMW(premiumBreakdown.ncdDiscount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-200 pt-2 text-[15px]">
                      <span className="font-bold text-primary">Total Premium Paid</span>
                      <span className="font-extrabold text-primary">{formatZMW(premiumBreakdown.finalPremium)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 border-t border-gray-100 p-4 flex gap-3 relative z-10">
                <button className="flex-1 py-3 bg-white border border-outline-variant text-on-surface-variant font-semibold rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">download</span> PDF
                </button>
                <button className="flex-1 py-3 bg-white border border-outline-variant text-on-surface-variant font-semibold rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">share</span> Share
                </button>
              </div>
            </div>

            {/* Road Tax (if applicable) */}
            {vehicleDetails?.includeRoadTax && (
              <div className="bg-white rounded-2xl shadow-sm border-t-4 border-t-green-500 border-x border-b border-gray-100">
                <div className="p-5 border-b border-gray-100 bg-green-50 flex items-center justify-between">
                  <div>
                    <h3 className="text-[17px] font-bold text-green-900">RTSA Road Tax Disc</h3>
                    <div className="text-[12px] font-bold text-green-700 mt-0.5">RECEIPT NO: RT-{Math.floor(100000 + Math.random() * 900000)}</div>
                  </div>
                  <span className="material-symbols-outlined text-green-600 text-3xl">directions_car</span>
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-2 bg-green-50 text-green-800 p-3 rounded-lg text-[13px] mb-3 border border-green-100">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    Your digital road tax disc has been emailed and is instantly valid with RTSA.
                  </div>
                  <button className="w-full py-3 bg-white border border-outline-variant text-on-surface-variant font-semibold rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">download</span> Download Road Tax Disc
                  </button>
                </div>
              </div>
            )}

            {/* Next Steps */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <h4 className="font-bold text-[15px] text-primary mb-3">What Happens Next?</h4>
              <div className="space-y-3">
                {[
                  { icon: 'email', text: 'Your policy PDF will be emailed within 30 minutes.' },
                  { icon: 'sms', text: 'An SMS confirmation has been sent to your number.' },
                  { icon: 'report_problem', text: 'To file a claim, visit the Claims section anytime.' },
                  { icon: 'event_repeat', text: `Renewal reminder will be sent on ${policyDates?.formattedReminder || 'expiry - 30 days'}.` },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-primary text-[18px] mt-0.5">{item.icon}</span>
                    <span className="text-[13px] text-on-surface-variant">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => navigate('/claims')}
                className="py-3 bg-surface-container-low text-primary font-semibold rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 border border-outline-variant"
              >
                <span className="material-symbols-outlined text-[18px]">report_problem</span> File Claim
              </button>
              <button
                onClick={handleFinish}
                className="py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-container transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">home</span> Home
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
