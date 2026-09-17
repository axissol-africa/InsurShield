import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';
import { formatZMW, formatDate } from '../utils/premiumEngine';
import { RTSA_ANNIVERSARY_FEE } from '../utils/rtsa';
import { downloadPolicyCertificate, downloadRtsaDisc } from '../utils/policyDocuments';
import JourneyProgress from '../components/JourneyProgress';
import { JOURNEY_COMPLETE } from '../components/journeySteps';

const ISSUE_DELAY_MS = 1500;

const coverLabel = (type) => (type === 'ThirdParty' ? 'Third party only' : 'Comprehensive');

export default function PolicyConfirmationPage() {
  const navigate = useNavigate();
  const { customer, vehicleDetails, vehicleValue, insuranceType, premiumBreakdown, policyDates, selectedQuote, matchRtsaAnniversary, addPolicy, markNcdCodeUsed, ncdCodeValidated, resetJourney } = useStore();
  const [issuing, setIssuing] = useState(true);

  const reference = (selectedQuote?.requestId || 'PENDING').slice(-6);
  const policyNumber = `POL-${reference}`;
  const insurancePremium = premiumBreakdown?.finalPremium ?? selectedQuote?.price ?? 0;
  const rtsaFee = matchRtsaAnniversary ? RTSA_ANNIVERSARY_FEE : 0;
  const premium = insurancePremium + rtsaFee;
  const validFrom = policyDates?.formattedStart || formatDate(new Date());
  const validUntil = policyDates?.formattedEnd || '—';
  const issuedPolicy = {
    policyNumber, insurer: selectedQuote?.name, vehicle: vehicleDetails ? `${vehicleDetails.year || ''} ${vehicleDetails.make || ''} ${vehicleDetails.model || ''}`.trim() : 'Vehicle',
    vehicleDetails, policyDates, customerName: customer?.fullName, premium,
  };

  useEffect(() => {
    if (!selectedQuote) return undefined;
    const timer = setTimeout(() => {
      addPolicy({
        policyNumber,
        insurer: selectedQuote.name,
        coverage: coverLabel(insuranceType),
        plan: selectedQuote.coverage,
        premium,
        insurancePremium,
        rtsaAnniversaryFee: rtsaFee,
        vehicle: vehicleDetails ? `${vehicleDetails.year || ''} ${vehicleDetails.make || ''} ${vehicleDetails.model || ''}`.trim() : 'Vehicle',
        vehicleDetails,
        vehicleValue,
        policyDates,
        customerName: customer?.fullName,
        customerEmail: customer?.email,
        customerPhone: customer?.phone,
      });
      if (ncdCodeValidated) markNcdCodeUsed();
      setIssuing(false);
    }, ISSUE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [addPolicy, customer, insurancePremium, insuranceType, markNcdCodeUsed, matchRtsaAnniversary, ncdCodeValidated, policyDates, policyNumber, premium, rtsaFee, selectedQuote, vehicleDetails, vehicleValue]);

  if (!selectedQuote) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-5">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-2xl font-extrabold">Nothing to confirm yet</h1>
          <p className="mt-2 text-secondary">Your issued policies are always available in your account.</p>
          <Link to="/account" className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-primary px-6 font-bold text-white hover:bg-primary-container">Go to my account</Link>
        </section>
      </main>
    );
  }

  const finish = () => {
    resetJourney();
    navigate('/account');
  };

  return (
    <>
      <JourneyProgress current={JOURNEY_COMPLETE} />
      <main className="flex min-h-[calc(100vh-80px)] flex-col items-center bg-slate-50 px-5 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg space-y-5">
          {issuing ? (
            <div className="rounded-2xl border border-gray-100 bg-white py-16 text-center shadow-sm" role="status" aria-live="polite">
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }} className="mx-auto h-14 w-14 rounded-full border-4 border-primary border-t-transparent" />
              <h1 className="mt-6 text-[24px] font-bold text-primary">Payment received</h1>
              <p className="mt-2 px-6 text-[14px] text-on-surface-variant">Issuing your policy with {selectedQuote.name}…</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }} className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/5">
                  <span className="material-symbols-outlined text-4xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">verified</span>
                </motion.div>
                <h1 className="text-[40px] font-extrabold tracking-[-.045em] text-primary">You're covered</h1>
                <p className="mt-2 text-[16px] text-secondary">Your policy is active and saved to your InsurShield account.</p>
              </div>

              <article className="relative overflow-hidden rounded-2xl border-x border-b border-t-4 border-slate-200 border-t-primary bg-white shadow-sm">
                <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 -rotate-12 select-none text-[6rem] font-black text-gray-50/60">INSURSHIELD</div>
                <header className="relative z-10 flex items-center justify-between border-b border-gray-100 bg-surface-container-low p-5">
                  <div>
                    <h2 className="text-[17px] font-bold text-primary">Policy certificate</h2>
                    <p className="mt-0.5 text-[12px] font-bold tracking-[0.05em] text-secondary">{policyNumber}</p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">Active</span>
                </header>

                <dl className="relative z-10 grid grid-cols-2 gap-4 p-5">
                  <Field label="Insurer" value={selectedQuote.name} highlight />
                  <Field label="Plan" value={`${selectedQuote.coverage} · ${coverLabel(insuranceType)}`} />
                  <Field label="Policyholder" value={customer?.fullName || '—'} />
                  <Field label="Contact" value={customer?.phone || customer?.email || '—'} />
                  <Field label="Vehicle" value={vehicleDetails ? `${vehicleDetails.year || ''} ${vehicleDetails.make} ${vehicleDetails.model}`.trim() : '—'} />
                  <Field label="Plate" value={vehicleDetails?.plateNumber || '—'} highlight mono />
                  <Field label="Insured value" value={vehicleValue > 0 ? formatZMW(vehicleValue) : '—'} />
                  <Field label="Chassis number" value={vehicleDetails?.chassisNumber || '—'} mono />
                  <Field label="Valid from" value={validFrom} />
                  <Field label="Valid until" value={validUntil} />
                </dl>

                <div className="relative z-10 mx-5 mb-5 rounded-xl bg-surface-container-low p-4 text-[13px]">
                  <div className="flex justify-between"><span className="text-on-surface-variant">Insurance premium ({premiumBreakdown?.coverageDuration || 'policy term'})</span><span className="font-semibold">{formatZMW(insurancePremium)}</span></div>
                  {premiumBreakdown?.ncdDiscount > 0 && <div className="mt-1 flex justify-between text-primary"><span>NCD discount ({premiumBreakdown.appliedNcdPercentage}%)</span><span className="font-semibold">− {formatZMW(premiumBreakdown.ncdDiscount)}</span></div>}
                  {rtsaFee > 0 && <div className="mt-1 flex justify-between text-primary"><span>RTSA anniversary fee</span><span className="font-semibold">{formatZMW(rtsaFee)}</span></div>}
                  <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-[15px]"><span className="font-bold text-primary">Total paid</span><span className="font-extrabold text-primary">{formatZMW(premium)}</span></div>
                </div>

                <footer className="relative z-10 flex gap-3 border-t border-gray-100 bg-gray-50 p-4">
                  <button type="button" onClick={() => downloadPolicyCertificate(issuedPolicy)} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-outline-variant bg-white py-3 font-semibold text-on-surface-variant hover:bg-gray-50"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">download</span>Download certificate</button>
                  <button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-outline-variant bg-white py-3 font-semibold text-on-surface-variant hover:bg-gray-50"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">share</span>Share</button>
              </footer>
              </article>

              {rtsaFee > 0 && (
                <section className="rounded-2xl border border-primary/20 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-[17px] font-bold text-primary">RTSA Road Tax Disc</h2>
                      <p className="mt-1 text-sm text-secondary">Your RTSA anniversary is included with this payment.</p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">Available</span>
                  </div>
                  <button type="button" onClick={() => downloadRtsaDisc(issuedPolicy)} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-primary bg-white px-4 text-sm font-bold text-primary hover:bg-primary/5"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">download</span>Download RTSA disc</button>
                </section>
              )}

              <section className="rounded-2xl border border-gray-100 bg-white p-5">
                <h2 className="mb-3 text-[15px] font-bold text-primary">What happens next</h2>
                <ul className="space-y-3 text-[13px] text-on-surface-variant">
                  <Next icon="shield">Your certificate and policy documents are in <strong>My account</strong> whenever you need them.</Next>
                  <Next icon="mail">{selectedQuote.name} will also send the official policy document to {customer?.email || 'your email'}.</Next>
                  {selectedQuote.inspectionRules === 'REQUIRED' && <Next icon="photo_camera">{selectedQuote.name} requires a vehicle inspection — they will contact you on {customer?.phone || 'your number'} to arrange it.</Next>}
                  <Next icon="event_repeat">We'll remind you to renew on {policyDates?.formattedReminder || '30 days before expiry'}.</Next>
                </ul>
              </section>

              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => navigate('/')} className="flex items-center justify-center gap-2 rounded-xl border border-outline-variant bg-surface-container-low py-3 font-semibold text-primary hover:bg-gray-100">Back to home</button>
                <button type="button" onClick={finish} className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white hover:bg-primary-container"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">account_circle</span>My account</button>
              </div>
            </>
          )}
        </motion.div>
      </main>
    </>
  );
}

function Field({ label, value, highlight = false, mono = false }) {
  return (
    <div>
      <dt className="mb-1 text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">{label}</dt>
      <dd className={`text-[14px] font-semibold ${highlight ? 'text-primary' : 'text-on-surface'} ${mono ? 'font-mono tracking-wider' : ''}`}>{value}</dd>
    </div>
  );
}

function Next({ icon, children }) {
  return (
    <li className="flex items-start gap-3">
      <span className="material-symbols-outlined mt-0.5 text-[18px] text-primary" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </li>
  );
}
