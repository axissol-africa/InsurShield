import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { motion, AnimatePresence } from 'framer-motion';
import { calculatePremium, calculatePolicyDates, formatZMW, validateNcdCode } from '../utils/premiumEngine';
import { COVERAGE_DURATION_OPTIONS } from '../utils/insurerRates';

export default function QuoteRequestFormPage() {
  const navigate = useNavigate();
  const {
    vehicleDetails, insuranceType, selectedInsurers, documents, setDocument,
    setQuoteStatus, vehicleValue, ncdCode, ncdCodeValidated, ncdCodeUsed,
    coverageDurationId, policyStartDate, piaConfig,
    setNcdCode, setNcdCodeValidated, clearNcdCode,
    setCoverageDuration, setPolicyStartDate, setPolicyDates,
    setPremiumBreakdown,
  } = useStore();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [ncdInput, setNcdInput] = useState(ncdCode || '');
  const [ncdValidating, setNcdValidating] = useState(false);
  const [ncdError, setNcdError] = useState('');
  const [formError, setFormError] = useState('');
  const [currency, setCurrency] = useState('ZMW');

  const safeInsurers = selectedInsurers || [];
  const inspectionRequired = safeInsurers.some(i => i.inspectionRules === 'REQUIRED');
  const inspectionOptional = safeInsurers.some(i => i.inspectionRules === 'OPTIONAL');

  // Computed policy dates
  const policyDates = calculatePolicyDates(policyStartDate, coverageDurationId || '4q');
  useEffect(() => { if (policyDates) setPolicyDates(policyDates); }, [policyStartDate, coverageDurationId]);

  // Best premium preview
  const premiumBreakdowns = safeInsurers.map(insurer => calculatePremium({
    vehicleValueZMW: vehicleValue,
    insurer,
    ncdCode: ncdCodeValidated && !ncdCodeUsed ? ncdInput : null,
    ncdPercentage: ncdCodeValidated?.percentage || 0,
    ncdIssuingInsurer: ncdCodeValidated?.insurer || null,
    coverageDurationId: coverageDurationId || '4q',
  })).sort((a, b) => a.finalPremium - b.finalPremium);
  const bestBreakdown = premiumBreakdowns[0];

  // ─── NCD Code Validation ───────────────────────────────────
  const handleValidateNcd = () => {
    if (!ncdInput.trim()) return;
    setNcdValidating(true);
    setNcdError('');
    setTimeout(() => {
      const result = validateNcdCode(ncdInput);
      setNcdValidating(false);
      if (result) {
        setNcdCode(ncdInput.trim().toUpperCase());
        setNcdCodeValidated(result);
        setNcdError('');
      } else {
        setNcdCodeValidated(null);
        setNcdError('Invalid NCD code. Please check the code issued by your insurer and try again.');
      }
    }, 1200);
  };

  const handleClearNcd = () => {
    setNcdInput('');
    clearNcdCode();
    setNcdError('');
  };

  // ─── Document Upload ───────────────────────────────────────
  const handleFileUpload = (type, e) => {
    if (e.target.files && e.target.files[0]) {
      setDocument(type, URL.createObjectURL(e.target.files[0]));
    }
  };

  const UploadBox = ({ title, type }) => (
    <div className="border-2 border-dashed border-outline-variant rounded-xl p-5 text-center hover:border-primary/50 transition-colors bg-surface-container-low">
      {documents[type] ? (
        <div className="space-y-2">
          <span className="material-symbols-outlined text-green-500 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-[13px] font-semibold">Uploaded</p>
          <img src={documents[type]} alt={title} className="mt-2 h-20 object-cover mx-auto rounded-lg shadow-sm" />
          <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setDocument(type, null)}>Retake</button>
        </div>
      ) : (
        <label className="cursor-pointer flex flex-col items-center gap-2">
          <div className="bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center text-primary hover:scale-110 transition-transform">
            <span className="material-symbols-outlined text-[24px]">photo_camera</span>
          </div>
          <span className="text-[13px] font-semibold">{title}</span>
          <span className="text-[11px] text-on-surface-variant">Click to capture or upload</span>
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleFileUpload(type, e)} />
        </label>
      )}
    </div>
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!documents.whiteBook) {
      setFormError('Please upload your White Book before requesting quotes.');
      return;
    }
    setFormError('');
    if (bestBreakdown) setPremiumBreakdown(bestBreakdown);
    setQuoteStatus('pending');
    navigate('/waiting');
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="pb-20 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8 px-4 md:px-8">

      {/* ─── Left Column: Form ─── */}
      <section className="lg:col-span-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 md:p-8 space-y-8">
          <div>
            <h2 className="text-[24px] font-bold text-primary mb-1">Quote Request Details</h2>
            <p className="text-[15px] text-on-surface-variant">Complete all sections to request your personalised quotes.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">

            {/* ── STEP 1: Contact ── */}
            <div>
              <SectionTitle number={1} label="Contact Information" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label>Full Name</Label>
                  <FieldInput required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Mwiza Banda" />
                </div>
                <div>
                  <Label>Email Address</Label>
                  <FieldInput required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. mwiza@email.com" />
                </div>
                <div>
                  <Label>Phone Number</Label>
                  <FieldInput required type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+260 970 000 000" />
                </div>
              </div>
            </div>

            <hr className="border-gray-100" />

            {/* ── STEP 2: Policy Start Date & Duration ── */}
            <div>
              <SectionTitle number={2} label="Policy Start Date & Coverage Duration" />
              <p className="text-[13px] text-on-surface-variant mb-4">
                Choose when your policy should start — this can be today or a future date (e.g. when your current policy expires). The end date will be calculated automatically.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Start Date */}
                <div>
                  <Label>Policy Start Date</Label>
                  <input
                    type="date"
                    value={policyStartDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={e => setPolicyStartDate(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] focus:ring-2 focus:ring-primary outline-none"
                  />
                  <p className="text-[11px] text-on-surface-variant mt-1">You can set a future start date if your current policy has not yet expired.</p>
                </div>
                {/* Duration Dropdown */}
                <div>
                  <Label>Coverage Duration</Label>
                  <div className="relative">
                    <select
                      value={coverageDurationId || '4q'}
                      onChange={e => setCoverageDuration(e.target.value)}
                      className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] focus:ring-2 focus:ring-primary outline-none"
                    >
                      {COVERAGE_DURATION_OPTIONS.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-3 top-3.5 text-gray-400 pointer-events-none">expand_more</span>
                  </div>
                </div>
              </div>

              {/* Calculated Date Card */}
              {policyDates && (
                <div className="bg-primary/5 border-2 border-primary/20 rounded-xl p-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-secondary tracking-wider mb-1">Start Date</p>
                      <p className="text-[15px] font-extrabold text-primary">{policyDates.formattedStart}</p>
                    </div>
                    <div className="border-x border-primary/20">
                      <p className="text-[10px] font-bold uppercase text-secondary tracking-wider mb-1">End Date</p>
                      <p className="text-[15px] font-extrabold text-primary">{policyDates.formattedEnd}</p>
                      <p className="text-[10px] text-secondary">{policyDates.daysTotal} days</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase text-amber-700 tracking-wider mb-1">🔔 Renewal Reminder</p>
                      <p className="text-[14px] font-extrabold text-amber-800">{policyDates.formattedReminder}</p>
                      <p className="text-[10px] text-amber-700">30 days before expiry</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <hr className="border-gray-100" />

            {/* ── STEP 3: NCD Code ── */}
            <div>
              <SectionTitle number={3} label="No Claim Discount (NCD) Code" />
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-blue-600 text-[18px] mt-0.5">info</span>
                  <div>
                    <p className="text-[13px] font-bold text-blue-900">Have an NCD Code?</p>
                    <p className="text-[12px] text-blue-800 mt-0.5">
                      If you have previously applied for a No Claim Discount through InsurShield and received an approved NCD code from your insurer, enter it here. Your discount will be applied to qualifying quotes.
                      <br />
                      <button type="button" onClick={() => navigate('/claims')} className="font-bold underline mt-1 inline-block">
                        → Apply for NCD in the Claims section
                      </button>
                    </p>
                  </div>
                </div>
              </div>

              {/* Used/blocked state */}
              {ncdCodeUsed ? (
                <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 flex items-center gap-3">
                  <span className="material-symbols-outlined text-gray-400 text-2xl">block</span>
                  <div>
                    <p className="font-bold text-gray-600 text-[14px]">NCD Code Already Used</p>
                    <p className="text-[12px] text-gray-500">This code has been applied to a previous policy and cannot be reused. Apply for a new NCD in the Claims section.</p>
                    <button type="button" onClick={() => navigate('/claims')} className="text-primary font-bold text-[12px] underline mt-1">Apply for New NCD →</button>
                  </div>
                </div>
              ) : ncdCodeValidated ? (
                <div className="bg-green-50 border-2 border-green-400 rounded-xl p-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="material-symbols-outlined text-green-600" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                      <span className="font-bold text-green-900">NCD Code Verified!</span>
                    </div>
                    <p className="font-mono text-[13px] font-bold text-green-800">{ncdInput.toUpperCase()}</p>
                    <p className="text-[12px] text-green-700 mt-1">
                      <strong>{ncdCodeValidated.percentage}% discount</strong> · {ncdCodeValidated.yearsClaimFree} year{ncdCodeValidated.yearsClaimFree > 1 ? 's' : ''} claim-free
                    </p>
                    {/* Single-use + issuer-only notice */}
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                      <p className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px]">business</span>
                        Valid for <strong>{ncdCodeValidated.insurer}</strong> only
                      </p>
                      <p className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px]">looks_one</span>
                        Single use — will expire after this quotation
                      </p>
                    </div>
                    {bestBreakdown && bestBreakdown.ncdDiscount > 0 && vehicleValue > 0 && (
                      <div className="mt-2 bg-green-100 rounded-lg p-2 text-[12px]">
                        <span className="font-bold">Estimated saving: </span>
                        <span className="text-green-800 font-extrabold">{formatZMW(bestBreakdown.ncdDiscount)}</span>
                        <span className="text-green-700"> on {ncdCodeValidated.insurer}</span>
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={handleClearNcd} className="text-[12px] font-bold text-red-600 hover:underline flex-shrink-0">Remove</button>
                </div>

              ) : (
                /* Code Entry */
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <div className="relative">
                        <span className="absolute left-3 top-3.5 text-[12px] font-bold text-on-surface-variant tracking-wider">NCD-</span>
                        <input
                          value={ncdInput.toUpperCase().replace('NCD-', '')}
                          onChange={e => setNcdInput('NCD-' + e.target.value.toUpperCase().replace('NCD-', ''))}
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleValidateNcd())}
                          placeholder="Enter your NCD code"
                          className="w-full bg-surface-container-low border border-outline-variant rounded-xl pl-12 pr-4 py-3 font-mono text-[15px] focus:ring-2 focus:ring-primary outline-none uppercase tracking-widest"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleValidateNcd}
                      disabled={ncdValidating || !ncdInput}
                      className="px-5 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary-container transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {ncdValidating ? <span className="material-symbols-outlined animate-spin text-[18px]">sync</span> : <span className="material-symbols-outlined text-[18px]">check_circle</span>}
                      {ncdValidating ? 'Checking...' : 'Validate'}
                    </button>
                  </div>
                  {ncdError && (
                    <p className="text-red-600 text-[12px] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">error</span> {ncdError}
                    </p>
                  )}
                  <p className="text-[11px] text-on-surface-variant">No code? <button type="button" onClick={() => navigate('/claims')} className="text-primary font-bold underline">Apply for NCD →</button></p>
                </div>
              )}
            </div>

            <hr className="border-gray-100" />

            {/* ── STEP 4: Documents ── */}
            <div>
              <SectionTitle number={4} label="Required Documents" />
              <p className="text-[13px] text-on-surface-variant mb-4">A White Book is required for registration. A driver's licence is only needed if you later submit a claim.</p>
              <div className="max-w-sm">
                <UploadBox title="White Book" type="whiteBook" />
              </div>
            </div>

            {inspectionRequired && (
              <div>
                <label className="text-[12px] font-bold tracking-[0.05em] text-indigo-900 uppercase mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-indigo-600 text-sm">photo_camera</span>
                  Vehicle Inspection Photos (Required)
                </label>
                <div className="bg-indigo-50/30 rounded-xl p-4 border border-indigo-100 grid grid-cols-2 gap-4">
                  <UploadBox title="Front View" type="insp_front" />
                  <UploadBox title="Back View" type="insp_back" />
                  <UploadBox title="Left Side" type="insp_left" />
                  <UploadBox title="Right Side" type="insp_right" />
                  <div className="col-span-2"><UploadBox title="Dashboard / Mileage" type="insp_mileage" /></div>
                </div>
              </div>
            )}

            <hr className="border-gray-100" />

            {/* ── STEP 5: Currency ── */}
            <div>
              <SectionTitle number={5} label="Preferred Currency" />
              <div className="flex flex-col sm:flex-row gap-3">
                {[{ id: 'ZMW', label: 'Zambian Kwacha (ZMW)' }, { id: 'USD', label: 'US Dollar (USD)' }].map(c => (
                  <label key={c.id} className="flex-1 cursor-pointer">
                    <input checked={currency === c.id} onChange={() => setCurrency(c.id)} className="sr-only peer" name="currency" type="radio" value={c.id} />
                    <div className="flex items-center justify-between p-4 border border-outline-variant rounded-xl peer-checked:border-primary peer-checked:bg-primary/5 hover:bg-gray-50 transition-all">
                      <span className="text-[15px] font-semibold text-primary">{c.label}</span>
                      {currency === c.id ? <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span> : <div className="w-6 h-6 border-2 border-outline-variant rounded-full" />}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Submit */}
            <div className="pt-2">
              {formError && <p className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-center text-[13px] font-medium text-red-700">{formError}</p>}
              <button type="submit" className="w-full bg-primary text-white font-semibold text-[16px] py-4 rounded-xl shadow-lg hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                <span>Submit Quote Request</span>
                <span className="material-symbols-outlined">send</span>
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* ─── Right Column: Summary ─── */}
      <aside className="lg:col-span-4 space-y-5">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden sticky top-24">
          <div className="h-28 overflow-hidden">
            <img className="w-full h-full object-cover" src="https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=800&q=80" alt="Vehicle" />
          </div>
          <div className="p-5 space-y-4">
            <h3 className="text-[17px] font-bold text-primary">Request Summary</h3>
            <SummaryRow icon="directions_car" label="Vehicle" value={vehicleDetails ? `${vehicleDetails.year} ${vehicleDetails.make} ${vehicleDetails.model}` : '—'} />
            <SummaryRow icon="tag" label="Registration" value={vehicleDetails?.plateNumber || '—'} />
            <SummaryRow icon="payments" label="Vehicle Value" value={vehicleValue > 0 ? formatZMW(vehicleValue) : '—'} highlight />
            <SummaryRow icon="gavel" label="PIA Min (4%)" value={vehicleValue > 0 ? `${formatZMW(vehicleValue * 0.04)}/yr` : '—'} />
            <SummaryRow icon="shield" label="Coverage Type" value={insuranceType || 'Comprehensive'} />
            {policyDates && <SummaryRow icon="calendar_today" label="Policy Period" value={`${policyDates.formattedStart} → ${policyDates.formattedEnd}`} />}
            {ncdCodeValidated && (
              <div className="flex items-start gap-3 pt-2 border-t border-gray-50">
                <span className="material-symbols-outlined text-green-600 text-[18px]">discount</span>
                <div>
                  <p className="text-[11px] font-bold uppercase text-green-800">NCD Applied</p>
                  <p className="text-[13px] font-semibold text-green-700">{ncdCodeValidated.percentage}% discount approved</p>
                </div>
              </div>
            )}
            {bestBreakdown && vehicleValue > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 mt-2">
                <p className="text-[11px] font-bold uppercase text-primary mb-1">Best Estimated Premium</p>
                <p className="text-[22px] font-extrabold text-primary">{formatZMW(bestBreakdown.finalPremium)}</p>
                <p className="text-[11px] text-secondary">{bestBreakdown.insurerName} · {bestBreakdown.coverageDuration}</p>
                {bestBreakdown.ncdDiscount > 0 && <p className="text-[11px] text-green-700 mt-1">Includes {bestBreakdown.appliedNcdPercentage}% NCD saving of {formatZMW(bestBreakdown.ncdDiscount)}</p>}
              </div>
            )}
            <button onClick={() => navigate('/vehicle-identification')} className="w-full text-[14px] font-semibold text-on-surface-variant hover:text-primary flex items-center justify-center gap-2 transition-colors pt-3 border-t border-gray-100">
              <span className="material-symbols-outlined text-[18px]">edit</span> Edit Vehicle Details
            </button>
          </div>
        </div>
      </aside>
    </motion.div>
  );
}

// ─── Shared Sub-components ─────────────────────────────────────────────────────
function SectionTitle({ number, label }) {
  return (
    <h3 className="text-[13px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-4 flex items-center gap-2">
      <span className="w-6 h-6 bg-primary text-white rounded-full text-[11px] font-bold flex items-center justify-center">{number}</span>
      {label}
    </h3>
  );
}

function Label({ children }) {
  return <label className="text-[12px] font-bold tracking-[0.05em] text-on-surface-variant uppercase mb-1.5 block">{children}</label>;
}

function FieldInput({ ...props }) {
  return <input {...props} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] focus:ring-2 focus:ring-primary outline-none" />;
}

function SummaryRow({ icon, label, value, highlight }) {
  return (
    <div className="flex items-start gap-3">
      <span className="material-symbols-outlined text-on-surface-variant text-[18px]">{icon}</span>
      <div>
        <p className="text-[11px] font-bold uppercase text-on-surface-variant">{label}</p>
        <p className={`text-[13px] font-semibold ${highlight ? 'text-primary' : 'text-on-surface'}`}>{value}</p>
      </div>
    </div>
  );
}
