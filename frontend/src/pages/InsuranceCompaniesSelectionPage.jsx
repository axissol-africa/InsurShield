import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';
import { calculatePremium, formatZMW } from '../utils/premiumEngine';
import { INSURER_RATES } from '../utils/insurerRates';

export default function InsuranceCompaniesSelectionPage() {
  const navigate = useNavigate();
  const { selectedInsurers, toggleInsurer, vehicleValue, ncdCode, ncdCodeValidated, coverageDurationId } = useStore();

  const handleContinue = () => {
    if (selectedInsurers.length > 0) navigate('/quote-form');
  };

  const isSelected = (insurerId) => selectedInsurers.some(i => i.id === insurerId);

  const getBreakdown = (insurer) => {
    if (!vehicleValue || vehicleValue <= 0) return null;
    return calculatePremium({
      vehicleValueZMW: vehicleValue,
      insurer,
      ncdCode: ncdCodeValidated ? ncdCode : null,
      ncdPercentage: ncdCodeValidated?.percentage || 0,
      ncdIssuingInsurer: ncdCodeValidated?.insurer || null,
      coverageDurationId: coverageDurationId || '4q',
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="pb-48 w-full max-w-4xl mx-auto px-4 pt-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-[24px] font-bold text-primary mb-2">Compare & Select Insurers</h1>
        <div className="flex items-start gap-3 bg-surface-container-low p-4 rounded-xl border border-surface-variant">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>info</span>
          <p className="text-[14px] text-on-surface-variant">
            Select up to 5 insurers. Premiums shown are based on your vehicle value of{' '}
            <strong>{vehicleValue > 0 ? formatZMW(vehicleValue) : 'N/A'}</strong>{' '}
            at the PIA minimum rate of 4% plus each insurer's applicable loadings.
            {ncdCodeValidated && (
              <span className="text-green-700 font-semibold"> NCD code applied ({ncdCodeValidated.percentage}% discount).</span>
            )}
          </p>
        </div>
        {!vehicleValue && (
          <div className="mt-3 bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-600 text-[18px]">warning</span>
            <p className="text-[13px] text-amber-900">Vehicle value not set. <button onClick={() => navigate('/vehicle-identification')} className="underline font-bold">Go back to set it</button> for accurate premiums.</p>
          </div>
        )}
      </div>

      {/* Insurer Cards */}
      <div className="space-y-4">
        {INSURER_RATES.map((insurer) => {
          const selected = isSelected(insurer.id);
          const disabled = !selected && selectedInsurers.length >= 5;
          const breakdown = getBreakdown(insurer);

          return (
            <div
              key={insurer.id}
              className={`bg-white rounded-xl shadow-sm transition-all duration-200 ${insurer.isBestValue ? 'border-2 border-[#C5A059]' : selected ? 'border-2 border-primary' : 'border border-gray-100'} ${disabled ? 'opacity-50 pointer-events-none' : 'hover:shadow-md'} relative overflow-hidden`}
            >
              {insurer.isBestValue && (
                <div className="absolute top-0 right-0 bg-[#C5A059] text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">BEST VALUE</div>
              )}
              <div className="p-5">
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 ${selected ? 'bg-primary/10' : 'bg-surface-container'} rounded-lg flex items-center justify-center`}>
                      <span className="material-symbols-outlined text-primary text-2xl">{insurer.icon}</span>
                    </div>
                    <div>
                      <h3 className="text-[18px] font-bold text-primary">{insurer.name}</h3>
                      <p className="text-[13px] text-secondary">{insurer.coverage}</p>
                    </div>
                  </div>

                  {/* Premium Display */}
                  <div className="text-right flex-shrink-0">
                    {breakdown ? (
                      <>
                        <div className="text-[11px] font-bold tracking-[0.05em] text-secondary uppercase mb-0.5">
                          {INSURER_RATES.find(i => i.id === insurer.id) ? 'Your Premium' : 'Estimated'}
                        </div>
                        <div className={`text-[26px] font-extrabold ${selected ? 'text-primary' : 'text-on-surface'}`}>
                          ZMW {Math.round(breakdown.finalPremium).toLocaleString()}
                        </div>
                        {breakdown.appliedNcdPercentage > 0 && (
                          <div className="text-[11px] text-green-600 font-bold flex items-center justify-end gap-1">
                            <span className="material-symbols-outlined text-[12px]">discount</span>
                            {breakdown.appliedNcdPercentage}% NCD applied
                          </div>
                        )}
                        {breakdown.isPiaBoosted && (
                          <div className="text-[10px] text-amber-700 font-semibold">PIA 4% minimum applied</div>
                        )}
                        <div className="text-[11px] text-secondary">Rate: {insurer.ratePercentage}% of vehicle value</div>
                      </>
                    ) : (
                      <>
                        <div className="text-[11px] font-bold text-secondary uppercase mb-0.5">Annual Rate</div>
                        <div className="text-[22px] font-extrabold text-primary">{insurer.ratePercentage}%</div>
                        <div className="text-[11px] text-secondary">of vehicle value</div>
                      </>
                    )}
                  </div>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border ${insurer.inspectionRules === 'REQUIRED' ? 'bg-amber-50 text-amber-900 border-amber-200' : insurer.inspectionRules === 'NOT REQUIRED' ? 'bg-green-50 text-green-900 border-green-200' : 'bg-blue-50 text-blue-900 border-blue-200'}`}>
                    <span className="material-symbols-outlined text-[14px]">{insurer.inspectionRules === 'REQUIRED' ? 'photo_camera' : 'fact_check'}</span>
                    Inspection: {insurer.inspectionRules}
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-[11px] font-bold">
                    <span className="material-symbols-outlined text-[14px]">schedule</span>
                    {insurer.timing}
                  </div>
                  {/* NCD badge: only show on the insurer that issued the code */}
                  {ncdCodeValidated && insurer.name === ncdCodeValidated.insurer && breakdown?.isNcdIssuer && (
                    <div className="flex items-center gap-1.5 bg-green-50 text-green-800 border border-green-300 px-3 py-1 rounded-full text-[11px] font-bold">
                      <span className="material-symbols-outlined text-[14px]">discount</span>
                      NCD {breakdown.appliedNcdPercentage}% Applied (Your Issuer)
                    </div>
                  )}
                </div>

                {/* Benefits */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-4">
                  {insurer.benefits.slice(0, 4).map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-green-600 text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      <span className="text-[12px] text-on-surface-variant">{b}</span>
                    </div>
                  ))}
                  {insurer.benefits.length > 4 && <p className="text-[12px] text-primary font-semibold">+{insurer.benefits.length - 4} more benefits</p>}
                </div>

                {/* Select toggle */}
                <div className="flex justify-end border-t border-slate-100 pt-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <span className={`text-[15px] font-semibold ${selected ? 'text-primary' : 'text-slate-500'} group-hover:text-primary transition-colors`}>
                      {selected ? 'Selected ✓' : 'Select Insurer'}
                    </span>
                    <input type="checkbox" checked={selected} onChange={() => !disabled && toggleInsurer(insurer)} className="w-6 h-6 rounded border-outline text-primary focus:ring-primary cursor-pointer" />
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky Bottom Bar */}
      <section className="fixed md:bottom-0 bottom-16 left-0 right-0 bg-white shadow-[0_-8px_16px_-4px_rgba(0,0,0,0.12)] border-t border-slate-100 z-40">
        <div className="max-w-4xl mx-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-bold tracking-[0.05em] text-primary">SELECTED</span>
              <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{selectedInsurers.length} / 5</span>
            </div>
            {selectedInsurers.length > 0 && vehicleValue > 0 && (
              <div className="text-[12px] text-secondary">
                Lowest: <strong className="text-primary">
                  {formatZMW(Math.min(...selectedInsurers.map(i => { const b = getBreakdown(i); return b ? b.finalPremium : Infinity; })))}
                </strong>
              </div>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
            {selectedInsurers.map(insurer => {
              const b = getBreakdown(insurer);
              return (
                <div key={insurer.id} className="flex-shrink-0 flex items-center gap-2 bg-red-50 border border-primary/20 p-2 rounded-lg pr-4">
                  <div className="w-8 h-8 bg-white rounded flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-lg">{insurer.icon || 'shield'}</span>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-primary leading-none">{insurer.name.split(' ')[0]}</div>
                    {b && <div className="text-[10px] text-primary/70">ZMW {Math.round(b.finalPremium).toLocaleString()}</div>}
                  </div>
                </div>
              );
            })}
            {selectedInsurers.length === 0 && <div className="text-[12px] text-gray-400 py-2">No insurers selected yet.</div>}
          </div>
          <button onClick={handleContinue} disabled={selectedInsurers.length === 0} className="w-full bg-primary text-white text-[16px] font-semibold py-4 rounded-xl shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50 disabled:pointer-events-none">
            Proceed to Request Quote ({selectedInsurers.length} selected)
          </button>
        </div>
      </section>
    </motion.div>
  );
}
