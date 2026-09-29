import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { RTSA_ANNIVERSARY_FEE } from '@/domain/rtsa';
import JourneyProgress from '@/features/quote-journey/components/JourneyProgress';
import { JOURNEY_COMPLETE } from '@/features/quote-journey/journeySteps';
import Meta from '@/components/ui/Meta';

const ISSUE_DELAY_MS = 1500;

const coverLabel = (type) => (type === 'ThirdParty' ? 'Third party only' : 'Comprehensive');

export default function PolicyConfirmationPage() {
  const navigate = useNavigate();
  const { customer, vehicleDetails, vehicleValue, insuranceType, premiumBreakdown, policyDates, selectedQuote, matchRtsaAnniversary, paymentReceipt, addPolicy, markNcdCodeUsed, ncdCodeValidated, resetJourney } = useStore();
  const [issuing, setIssuing] = useState(true);

  const reference = (selectedQuote?.requestId || 'PENDING').slice(-6);
  const policyNumber = `POL-${reference}`;
  const insurancePremium = premiumBreakdown?.finalPremium ?? selectedQuote?.price ?? 0;
  const rtsaFee = matchRtsaAnniversary ? RTSA_ANNIVERSARY_FEE : 0;
  const premium = insurancePremium + rtsaFee;
  const validFrom = policyDates?.formattedStart || formatDate(new Date());
  const validUntil = policyDates?.formattedEnd || '—';
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
        quoteRequestId: selectedQuote.requestId || null,
        insurerQuoteReference: selectedQuote.reply?.insurerReference || null,
        quoteDocument: selectedQuote.reply?.document || null,
        paymentStatus: 'Paid',
        paymentProof: paymentReceipt || { transactionId: `TXN-${selectedQuote.requestId?.slice(-6) || 'PENDING'}`, status: 'Confirmed', amount: premium, currency: 'ZMW', confirmedAt: new Date().toISOString() },
        status: 'Awaiting insurer certificate',
      });
      if (ncdCodeValidated) markNcdCodeUsed();
      setIssuing(false);
    }, ISSUE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [addPolicy, customer, insurancePremium, insuranceType, markNcdCodeUsed, matchRtsaAnniversary, ncdCodeValidated, paymentReceipt, policyDates, policyNumber, premium, rtsaFee, selectedQuote, vehicleDetails, vehicleValue]);

  if (!selectedQuote) {
    return (
      <main className="relative overflow-hidden">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
        <div className="relative mx-auto flex min-h-[60vh] w-full max-w-[560px] items-center px-6 py-12">
          <section className="w-full border border-line bg-canvas p-8">
            <Meta className="text-ink-muted">Confirmation</Meta>
            <h1 className="mt-5 text-[28px] font-semibold tracking-[-0.03em] text-ink">Nothing to confirm yet</h1>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-muted">Your issued policies are always available in your account.</p>
            <Link to="/account" className="mt-8 inline-flex min-h-12 items-center rounded-[1px] bg-primary px-6 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">Go to my account</Link>
          </section>
        </div>
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
      <main className="relative overflow-hidden">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-[1120px] px-6 py-12 pb-24 lg:px-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full">
          {issuing ? (
            <div className="mx-auto flex min-h-[50vh] max-w-[560px] flex-col items-center justify-center border border-line bg-canvas p-12 text-center" role="status" aria-live="polite">
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }} className="h-14 w-14 rounded-full border-2 border-primary border-t-transparent" />
              <Meta className="mt-8 text-primary">Payment received</Meta>
              <p className="mt-4 text-[15px] leading-[1.6] text-ink-muted">Sending your paid quote to {selectedQuote.name} for policy issue…</p>
            </div>
          ) : (
            <>
              <header className="border-b border-line pb-8">
                <span className="inline-flex items-center gap-3">
                  <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
                  <Meta className="text-ink-muted">Journey complete · Confirmation</Meta>
                </span>
                <div className="mt-6 flex items-start gap-5">
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }} className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/[0.06]">
                    <span className="material-symbols-outlined text-[26px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">verified</span>
                  </motion.span>
                  <div>
                    <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[42px]">Payment received</h1>
                    <p className="mt-4 max-w-[52ch] text-[16px] leading-[1.6] text-ink-muted">{selectedQuote.name} is preparing your official policy certificate.</p>
                  </div>
                </div>
              </header>

              <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_360px] lg:items-start">

              <article className="relative overflow-hidden border-x border-b border-t-2 border-line border-t-primary bg-canvas">
                <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 -rotate-12 select-none whitespace-nowrap font-mono text-[5rem] font-semibold tracking-[-0.03em] text-ink/[0.035]">INSURSHIELD</div>
                <header className="relative z-10 flex items-center justify-between border-b border-line bg-canvas-2 p-5">
                  <div>
                    <Meta className="text-primary">Paid quote confirmation</Meta>
                    <p className="mt-2.5 font-mono text-[13px] tracking-[0.02em] text-ink-muted">{selectedQuote.requestId}</p>
                  </div>
                  <Meta className="rounded-[1px] border border-dashed border-line-strong px-2.5 py-1.5 text-ink-muted">Awaiting certificate</Meta>
                </header>

                <dl className="relative z-10 grid grid-cols-2 gap-x-8 gap-y-6 p-6 sm:grid-cols-3">
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

                <div className="relative z-10 mx-6 mb-6 border border-dashed border-line-strong bg-canvas-2 p-5 text-[13px]">
                  <div className="flex justify-between"><span className="text-ink-muted">Insurance premium ({premiumBreakdown?.coverageDuration || 'policy term'})</span><span className="font-semibold">{formatZMW(insurancePremium)}</span></div>
                  {premiumBreakdown?.ncdDiscount > 0 && <div className="mt-1 flex justify-between text-primary"><span>NCD discount ({premiumBreakdown.appliedNcdPercentage}%)</span><span className="font-semibold">− {formatZMW(premiumBreakdown.ncdDiscount)}</span></div>}
                  {rtsaFee > 0 && <div className="mt-1 flex justify-between text-primary"><span>RTSA anniversary fee</span><span className="font-semibold">{formatZMW(rtsaFee)}</span></div>}
                  <div className="mt-2 flex justify-between border-t border-line pt-2 text-[15px]"><span className="font-medium text-primary">Total paid</span><span className="font-semibold text-primary">{formatZMW(premium)}</span></div>
                </div>

                <footer className="relative z-10 border-t border-line bg-canvas-2 p-5 text-[13px] leading-[1.55] text-ink-muted"><span className="material-symbols-outlined mr-2 align-middle text-primary" aria-hidden="true">pending_actions</span>Your insurer will upload the official certificate. It will then be available in My account.</footer>
              </article>

              <aside className="space-y-6 lg:sticky lg:top-24">
                {rtsaFee > 0 && (
                  <section className="ticked border border-primary bg-canvas p-5">
                    <div className="flex items-start justify-between gap-4">
                      <Meta className="text-primary">RTSA road tax disc</Meta>
                      <Meta className="shrink-0 rounded-[1px] border border-dashed border-line-strong px-2.5 py-1.5 text-ink-muted">With certificate</Meta>
                    </div>
                    <p className="mt-4 text-[13px] leading-[1.55] text-ink-muted">Your RTSA anniversary is included with this payment. The disc becomes available once your insurer issues the policy certificate.</p>
                  </section>
                )}

                <section className="border border-line bg-canvas">
                  <div className="border-b border-dashed border-line px-5 py-4">
                    <Meta className="text-primary">What happens next</Meta>
                  </div>
                  <ul className="space-y-4 p-5 text-[13px] leading-[1.55] text-ink-muted">
                    <Next icon="shield">Your certificate and policy documents are in <strong className="font-medium text-ink">My account</strong> whenever you need them.</Next>
                    <Next icon="mail">{selectedQuote.name} will also send the official policy document to {customer?.email || 'your email'}.</Next>
                    {selectedQuote.inspectionRules === 'REQUIRED' && <Next icon="photo_camera">{selectedQuote.name} requires a vehicle inspection — they will contact you on {customer?.phone || 'your number'} to arrange it.</Next>}
                    <Next icon="event_repeat">We'll remind you to renew on {policyDates?.formattedReminder || '30 days before expiry'}.</Next>
                  </ul>
                </section>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => navigate('/')} className="inline-flex min-h-12 items-center justify-center rounded-[1px] border border-dashed border-line-strong text-[14px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary">Back to home</button>
                  <button type="button" onClick={finish} className="group relative inline-flex min-h-12 items-center justify-center gap-2 overflow-hidden rounded-[1px] bg-primary text-[14px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">
                    <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
                    <span className="material-symbols-outlined relative text-[18px]" aria-hidden="true">account_circle</span>
                    <span className="relative">My account</span>
                  </button>
                </div>
              </aside>
              </div>
            </>
          )}
        </motion.div>
        </div>
      </main>
    </>
  );
}

function Field({ label, value, highlight = false, mono = false }) {
  return (
    <div className="min-w-0">
      <dt><Meta className="text-ink-faint">{label}</Meta></dt>
      <dd className={`mt-2 break-words text-[14px] font-medium leading-[1.45] tracking-[-0.01em] ${highlight ? 'text-primary' : 'text-ink'} ${mono ? 'font-mono tracking-[0.04em]' : ''}`}>{value}</dd>
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
