import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';
import { api } from '@/api';
import { useStore } from '@/store';
import { formatZMW } from '@/domain/premiumEngine';
import { RTSA_ANNIVERSARY_FEE } from '@/domain/rtsa';
import { quoteValidity } from '@/domain/quoteValidity';
import JourneyProgress from '@/features/quote-journey/components/JourneyProgress';

const NETWORKS = ['MTN Mobile Money', 'Airtel Money', 'Zamtel Kwacha'];

const fieldClass = 'w-full rounded-lg border border-outline-variant bg-surface-container-low p-3 text-[16px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
const labelClass = 'mb-2 block text-[12px] font-bold uppercase tracking-[0.05em] text-on-surface-variant';

export default function PaymentPage() {
  const navigate = useNavigate();
  const { selectedQuote, vehicleDetails, policyDates, customer, matchRtsaAnniversary, requoteFromRequest, recordPayment } = useStore();
  const [expiredAtPay, setExpiredAtPay] = useState(false);
  const [method, setMethod] = useState('momo');
  const [mobileNumber, setMobileNumber] = useState(customer?.phone || '');
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  if (!selectedQuote) {
    return (
      <>
        <JourneyProgress current={6} />
        <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-5">
          <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <h1 className="text-2xl font-extrabold">Choose a quote first</h1>
            <p className="mt-2 text-secondary">Pick the insurer you want from your comparison and we'll bring you back here to pay.</p>
            <Link to="/quotes-comparison" className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-primary px-6 font-bold text-white hover:bg-primary-container">Back to quotes</Link>
          </section>
        </main>
      </>
    );
  }

  const rtsaFee = matchRtsaAnniversary ? RTSA_ANNIVERSARY_FEE : 0;
  const total = selectedQuote.price + rtsaFee;
  // A final quote is an offer with a deadline: checked when the page opens and again on Pay.
  const validity = quoteValidity(selectedQuote.validUntil ? { validUntil: selectedQuote.validUntil } : null);
  const quoteExpired = validity.expired || expiredAtPay;

  const requote = () => {
    if (selectedQuote.requestId) requoteFromRequest(selectedQuote.requestId);
    navigate('/quote-request');
  };

  if (quoteExpired) {
    return (
      <>
        <JourneyProgress current={6} />
        <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-5">
          <section role="alert" className="w-full rounded-2xl border border-red-200 bg-white p-8 text-center">
            <span className="material-symbols-outlined text-[48px] text-red-700" aria-hidden="true">event_busy</span>
            <h1 className="mt-3 text-2xl font-extrabold">This quote has expired</h1>
            <p className="mt-2 text-secondary">{selectedQuote.name}'s quote {validity.validUntil ? `was valid until ${validity.label.replace('Expired on ', '')}` : 'is no longer valid'}. Insurers need to quote again before you can pay — your vehicle details are carried over.</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button type="button" onClick={requote} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 font-bold text-white hover:bg-primary-container"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>Get fresh quotes</button>
              <Link to="/quotes-comparison" className="inline-flex min-h-12 items-center justify-center rounded-lg border-2 border-primary px-6 font-bold text-primary hover:bg-primary/5">See other quotes</Link>
            </div>
          </section>
        </main>
      </>
    );
  }

  const handlePay = async (event) => {
    event.preventDefault();
    // Re-check at the moment of authorisation; a quote valid now stays purchasable while confirmation is pending.
    if (quoteValidity(selectedQuote.validUntil ? { validUntil: selectedQuote.validUntil } : null).expired) { setExpiredAtPay(true); return; }
    setProcessing(true);
    setPaymentError('');
    try {
      const receipt = await api.payments.pay({
        quoteRequestId: selectedQuote.requestId,
        insurer: selectedQuote.name,
        amount: total,
        method: method === 'momo' ? 'Mobile money' : 'Card',
        mobileNumber: method === 'momo' ? mobileNumber : undefined,
      });
      recordPayment(receipt);
      navigate('/confirmation', { replace: true });
    } catch (caught) {
      setPaymentError(caught.message || 'The payment could not be completed. Please try again.');
      setProcessing(false);
    }
  };

  return (
    <>
      <JourneyProgress current={6} />
      <main className="bg-slate-50/70 px-5 py-10 sm:px-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_400px] lg:items-start">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <h1 className="text-[28px] font-extrabold tracking-[-.03em] text-on-surface">Confirm and pay</h1>
            <p className="mt-1 text-[15px] text-secondary">Once payment is confirmed, {selectedQuote.name} prepares your official policy certificate; it appears in My account when issued.</p>

            <dl className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Summary label="Insurer" value={selectedQuote.name} />
              <Summary label="Plan" value={selectedQuote.coverage} />
              <Summary label="Vehicle" value={vehicleDetails ? `${vehicleDetails.year || ''} ${vehicleDetails.make} ${vehicleDetails.model}`.trim() : '—'} />
              <Summary label="Plate" value={vehicleDetails?.plateNumber || '—'} />
              <Summary label="Cover period" value={policyDates ? `${policyDates.formattedStart} – ${policyDates.formattedEnd}` : selectedQuote.breakdown?.coverageDuration || '—'} />
              <Summary label="Premium basis" value={selectedQuote.isFinal ? 'Final quote from insurer' : 'Indicative estimate · confirmed by insurer on issue'} />
              {validity.validUntil && <Summary label="Quote validity" value={validity.label} highlight={validity.expiringSoon} />}
            </dl>

            <Link to="/quotes-comparison" className="mt-6 inline-flex items-center gap-1 text-[14px] font-semibold text-primary hover:underline">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>Choose a different insurer
            </Link>
          </section>

          <aside className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-24">
            <div className="border-b border-gray-100 bg-surface-container-low p-6">
              <h2 className="mb-4 text-[13px] font-bold uppercase tracking-wider text-on-surface-variant">Payment summary</h2>
              <div className="space-y-3 text-[15px]">
                <div className="flex items-center justify-between"><span>Insurance premium</span><span className="font-semibold">{formatZMW(selectedQuote.price)}</span></div>
                {rtsaFee > 0 && <div className="flex items-center justify-between text-primary"><span>RTSA anniversary fee</span><span className="font-semibold">{formatZMW(rtsaFee)}</span></div>}
                <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3 text-[18px]"><span className="font-bold">Total</span><span className="font-extrabold text-primary">{formatZMW(total)}</span></div>
              </div>
            </div>

            <form onSubmit={handlePay} className="p-6">
              <div role="tablist" aria-label="Payment method" className="mb-6 flex gap-3">
                {[['momo', 'smartphone', 'Mobile money'], ['card', 'credit_card', 'Card']].map(([id, icon, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={method === id} onClick={() => setMethod(id)} className={cn('flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border-2 text-[14px] font-semibold transition-all', method === id ? 'border-primary bg-white text-primary' : 'border-slate-200 text-on-surface-variant hover:text-primary')}>
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>{label}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {method === 'momo' ? (
                  <motion.div key="momo" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-4">
                    <label className="block"><span className={labelClass}>Mobile number</span><input type="tel" required autoComplete="tel" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} className={fieldClass} /></label>
                    <label className="block"><span className={labelClass}>Network</span><select required className={fieldClass}>{NETWORKS.map((network) => <option key={network}>{network}</option>)}</select></label>
                    <p className="text-[12px] text-secondary">You'll receive a prompt on this number to approve the payment.</p>
                  </motion.div>
                ) : (
                  <motion.div key="card" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-4">
                    <label className="block"><span className={labelClass}>Card number</span><input inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" required className={fieldClass} /></label>
                    <div className="grid grid-cols-2 gap-4">
                      <label className="block"><span className={labelClass}>Expiry</span><input autoComplete="cc-exp" placeholder="MM/YY" required className={fieldClass} /></label>
                      <label className="block"><span className={labelClass}>CVV</span><input type="password" inputMode="numeric" autoComplete="cc-csc" placeholder="123" required className={fieldClass} /></label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {paymentError && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">{paymentError}</p>}
              <button type="submit" disabled={processing} className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-bold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-container disabled:opacity-60">
                <span className={cn('material-symbols-outlined text-[20px]', processing && 'animate-spin')} aria-hidden="true">{processing ? 'sync' : 'lock'}</span>
                {processing ? 'Processing payment…' : `Pay ${formatZMW(total)}`}
              </button>
              <p className="mt-3 text-center text-[12px] text-secondary">Payments are processed securely. Prototype: no real charge is made.</p>
            </form>
          </aside>
        </motion.div>
      </main>
    </>
  );
}

function Summary({ label, value, highlight = false }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">{label}</dt>
      <dd className={`mt-1 text-[15px] font-semibold ${highlight ? 'text-amber-800' : 'text-on-surface'}`}>{value}</dd>
    </div>
  );
}
