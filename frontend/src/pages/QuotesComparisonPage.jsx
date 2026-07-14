import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';
import { calculatePremium, formatZMW } from '../utils/premiumEngine';

const RequestId = `SHIELD-${Math.floor(10000 + Math.random() * 90000)}`;

export default function QuotesComparisonPage() {
  const navigate = useNavigate();
  const {
    selectedInsurers, setSelectedQuote, setPremiumBreakdown,
    vehicleValue, ncdCode, ncdCodeValidated, coverageDurationId,
    policyDates,
  } = useStore();

  const handleSelectQuote = (quote, breakdown) => {
    setSelectedQuote({ ...quote, price: breakdown.finalPremium });
    setPremiumBreakdown(breakdown);
    navigate('/payment');
  };

  const readyCount = Math.max(1, Math.ceil(selectedInsurers.length / 2));
  const readyInsurers = selectedInsurers.slice(0, readyCount);
  const pendingInsurers = selectedInsurers.slice(readyCount);

  // Calculate real premiums using NCD code
  const quotes = useMemo(() => {
    return readyInsurers.map(insurer => {
      const breakdown = calculatePremium({
        vehicleValueZMW: vehicleValue,
        insurer,
        ncdCode: ncdCodeValidated ? ncdCode : null,
        ncdPercentage: ncdCodeValidated?.percentage || 0,
        ncdIssuingInsurer: ncdCodeValidated?.insurer || null,
        coverageDurationId: coverageDurationId || '4q',
      });
      return { ...insurer, breakdown };
    }).sort((a, b) => a.breakdown.finalPremium - b.breakdown.finalPremium);
  }, [selectedInsurers.length, vehicleValue, ncdCode, ncdCodeValidated, coverageDurationId]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full pb-16">

      {/* Summary Banner */}
      <section className="max-w-5xl mx-auto mb-8 px-4">
        <div className="bg-primary text-white p-6 rounded-xl shadow-md relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-[28px] md:text-[32px] font-bold mb-1">Quote Comparison</h1>
              <p className="text-[14px] opacity-90">Vehicle Value: <strong>{vehicleValue > 0 ? formatZMW(vehicleValue) : 'Not set'}</strong></p>
              {policyDates && (
                <p className="text-[12px] opacity-80">Coverage: {policyDates.formattedStart} → {policyDates.formattedEnd} ({policyDates.daysTotal} days)</p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-white/10 backdrop-blur-md p-4 rounded-lg border border-white/20">
              <div>
                <p className="text-[11px] font-bold tracking-[0.05em] uppercase text-white/70">Request ID</p>
                <p className="text-[15px] font-semibold tracking-wider">#{RequestId}</p>
              </div>
              <div className="w-px h-8 bg-white/20 hidden sm:block" />
              <div>
                <p className="text-[11px] font-bold tracking-[0.05em] uppercase text-white/70">Quotes Expire</p>
                <p className="text-[15px] font-semibold">48 Hours</p>
              </div>
              <div className="w-px h-8 bg-white/20 hidden sm:block" />
              <div>
                <p className="text-[11px] font-bold tracking-[0.05em] uppercase text-white/70">Ready</p>
                <p className="text-[15px] font-semibold">{readyInsurers.length} of {selectedInsurers.length}</p>
              </div>
            </div>
          </div>
          <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/5 rounded-full blur-3xl" />
        </div>
      </section>

      {/* Quote Cards */}
      <section className="max-w-5xl mx-auto space-y-5 px-4">
        {quotes.map((quote, idx) => {
          const bd = quote.breakdown;
          const isRecommended = idx === 0;

          return (
            <motion.div
              key={quote.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.08 }}
              className={`bg-white border rounded-xl overflow-hidden flex flex-col lg:flex-row transition-all hover:-translate-y-1 hover:shadow-xl ${isRecommended ? 'border-l-4 border-l-[#C5A059] shadow-lg' : 'border-gray-100 shadow-sm'}`}
            >
              {/* Left: Details */}
              <div className="p-6 flex-1 border-b lg:border-b-0 lg:border-r border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-surface-container-low border border-gray-100 rounded-xl flex items-center justify-center">
                      <span className="material-symbols-outlined text-primary text-3xl">{quote.icon || 'business'}</span>
                    </div>
                    <div>
                      <h3 className="text-[19px] font-bold text-primary">{quote.name}</h3>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="material-symbols-outlined text-amber-500 text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                        <span className="text-[12px] font-bold text-secondary">4.8 · {quote.coverage}</span>
                      </div>
                    </div>
                  </div>
                  {isRecommended && (
                    <span className="bg-[#C5A059] text-white px-3 py-1 rounded-full text-[11px] font-bold tracking-wider">BEST DEAL</span>
                  )}
                </div>

                {/* Benefits */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                  {(quote.benefits || []).map((b, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className={`material-symbols-outlined text-[16px] mt-0.5 ${isRecommended ? 'text-primary' : 'text-secondary'}`} style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      <span className="text-[13px] text-on-surface-variant">{b}</span>
                    </div>
                  ))}
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-50">
                  <span className="text-[10px] font-bold bg-surface-container px-2 py-1 rounded-full text-secondary">Rate: {quote.ratePercentage}%</span>
                  {/* Only show NCD badge on the insurer that issued the code */}
                  {bd.isNcdIssuer && bd.ncdDiscount > 0 && (
                    <span className="text-[10px] font-bold bg-green-50 text-green-800 px-2 py-1 rounded-full border border-green-200">✓ NCD {bd.appliedNcdPercentage}% Applied</span>
                  )}
                  <span className="text-[10px] font-bold bg-surface-container px-2 py-1 rounded-full text-secondary">Inspection: {quote.inspectionRules}</span>
                </div>
              </div>

              {/* Right: Pricing */}
              <div className={`${isRecommended ? 'bg-primary/5' : 'bg-white'} lg:w-72 p-6 flex flex-col justify-center items-center text-center`}>
                {/* Premium Breakdown */}
                <div className="w-full space-y-2 mb-5 text-[13px]">
                  <div className="flex justify-between text-on-surface-variant">
                    <span>Base Premium</span>
                    <span className="font-semibold">{formatZMW(bd.basePremium)}</span>
                  </div>
                  {bd.ncdDiscount > 0 && (
                    <div className="flex justify-between text-green-700">
                      <span>NCD ({bd.appliedNcdPercentage}%)</span>
                      <span className="font-semibold">- {formatZMW(bd.ncdDiscount)}</span>
                    </div>
                  )}
                  {bd.isPiaBoosted && (
                    <div className="flex items-center gap-1 text-amber-700 text-[11px]">
                      <span className="material-symbols-outlined text-[13px]">info</span>
                      <span>PIA minimum applied</span>
                    </div>
                  )}
                  <div className="border-t border-gray-200 pt-2" />
                </div>

                <p className="text-[11px] font-bold tracking-[0.05em] text-secondary mb-1 uppercase">{bd.coverageDuration}</p>
                <div className="mb-5">
                  <span className={`text-[36px] font-extrabold ${isRecommended ? 'text-primary' : 'text-on-surface'}`}>
                    ZMW {Math.round(bd.finalPremium).toLocaleString()}
                  </span>
                </div>

                {bd.piaMet ? (
                  <div className="text-[10px] font-bold text-green-700 bg-green-50 px-3 py-1 rounded-full mb-4 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">verified</span> PIA Compliant
                  </div>
                ) : (
                  <div className="text-[10px] font-bold text-amber-700 bg-amber-50 px-3 py-1 rounded-full mb-4">⚠️ Below PIA Minimum</div>
                )}

                <button
                  onClick={() => handleSelectQuote(quote, bd)}
                  className={`w-full py-4 rounded-xl font-bold transition-all active:scale-[0.98] ${isRecommended ? 'bg-primary text-white hover:bg-primary-container shadow-lg shadow-primary/25' : 'border-2 border-primary text-primary hover:bg-red-50'}`}
                >
                  Select This Quote
                </button>
                <p className="mt-3 text-[12px] font-semibold text-on-surface-variant cursor-pointer hover:text-primary hover:underline">View Full Policy Terms</p>
              </div>
            </motion.div>
          );
        })}
      </section>

      {/* Pending Insurers */}
      {pendingInsurers.length > 0 && (
        <section className="max-w-5xl mx-auto mt-8 px-4">
          <div className="bg-orange-50 border border-orange-100 p-5 rounded-xl">
            <div className="flex items-start gap-3 mb-4">
              <span className="material-symbols-outlined text-orange-500 animate-pulse">hourglass_empty</span>
              <div>
                <h3 className="text-[15px] font-semibold text-orange-900">Awaiting {pendingInsurers.length} More Quote{pendingInsurers.length > 1 ? 's' : ''}</h3>
                <p className="text-[13px] text-orange-800/80">These insurers are still calculating. Proceed with the quotes above, or wait.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {pendingInsurers.map(ins => (
                <div key={ins.id} className="bg-white/70 border border-orange-200/50 p-3 rounded-lg flex items-center gap-2">
                  <span className="material-symbols-outlined text-orange-300 text-xl">{ins.icon || 'business'}</span>
                  <div>
                    <p className="text-[13px] font-semibold text-orange-900">{ins.name}</p>
                    <p className="text-[11px] text-orange-700/70">Awaiting...</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Help Section */}
      <section className="max-w-5xl mx-auto mt-12 mb-12 px-4">
        <div className="bg-surface-container border border-outline-variant p-8 rounded-2xl flex flex-col md:flex-row items-center gap-6">
          <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-white text-3xl">headset_mic</span>
          </div>
          <div className="flex-1 text-center md:text-left">
            <h2 className="text-[22px] font-bold text-primary mb-1">Need help choosing?</h2>
            <p className="text-[15px] text-on-surface-variant">Our insurance advisors can explain each policy in detail. Book a free call.</p>
          </div>
          <button onClick={() => navigate('/support')} className="px-8 py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-container transition-colors shadow-lg whitespace-nowrap">
            Contact Support
          </button>
        </div>
      </section>
    </motion.div>
  );
}
