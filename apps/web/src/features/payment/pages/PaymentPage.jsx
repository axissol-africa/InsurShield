import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';
import { api } from '@/api';
import { useStore } from '@/store';
import { formatZMW } from '@/domain/premiumEngine';
import { coverPeriodLabel } from '@/domain/coverPeriod';
import { RTSA_ANNIVERSARY_FEE } from '@/domain/rtsa';
import { quoteValidity } from '@/domain/quoteValidity';
import JourneyProgress from '@/features/quote-journey/components/JourneyProgress';
import { fieldClass } from '@/components/ui/field';
import Meta from '@/components/ui/Meta';

const NETWORKS = ['MTN Mobile Money', 'Airtel Money', 'Zamtel Kwacha'];

const labelClass = 'mb-2 block text-[12px] font-medium uppercase tracking-[0.05em] text-ink-muted';

export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const captureCode = searchParams.get('capture');
  const continuation = (path) => `${path}${captureCode ? `?capture=${encodeURIComponent(captureCode)}` : ''}`;
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
        <main className="relative overflow-hidden">
          <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
          <div className="relative mx-auto flex min-h-[60vh] w-full max-w-[560px] items-center px-6 py-12">
            <section className="w-full border border-line bg-canvas p-8">
              <span className="inline-flex items-center gap-3">
                <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
                <Meta className="text-ink-muted">Step 06 · Payment</Meta>
              </span>
              <h1 className="mt-6 text-[28px] font-semibold tracking-[-0.03em] text-ink">Choose a quote first</h1>
              <p className="mt-3 text-[15px] leading-[1.6] text-ink-muted">Pick the insurer you want from your comparison and we'll bring you back here to pay.</p>
              <Link to={continuation('/quotes-comparison')} className="mt-8 inline-flex min-h-12 items-center rounded-[1px] bg-primary px-6 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">Back to quotes</Link>
            </section>
          </div>
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
    navigate(continuation('/quote-request'));
  };

  if (quoteExpired) {
    return (
      <>
        <JourneyProgress current={6} />
        <main className="relative overflow-hidden">
          <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
          <div className="relative mx-auto flex min-h-[60vh] w-full max-w-[560px] items-center px-6 py-12">
            <section role="alert" className="ticked w-full border border-primary bg-canvas p-8">
              <span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">event_busy</span>
              <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.03em] text-ink">This quote has expired</h1>
              <p className="mt-3 text-[15px] leading-[1.6] text-ink-muted">{selectedQuote.name}'s quote {validity.validUntil ? `was valid until ${validity.label.replace('Expired on ', '')}` : 'is no longer valid'}. Insurers need to quote again before you can pay — your vehicle details are carried over.</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={requote} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[1px] bg-primary px-6 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>Get fresh quotes</button>
                <Link to={continuation('/quotes-comparison')} className="inline-flex min-h-12 items-center justify-center rounded-[1px] border border-dashed border-line-strong px-6 text-[15px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary">See other quotes</Link>
              </div>
            </section>
          </div>
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
      navigate(continuation('/confirmation'), { replace: true });
    } catch (caught) {
      setPaymentError(caught.message || 'The payment could not be completed. Please try again.');
      setProcessing(false);
    }
  };

  return (
    <>
      <JourneyProgress current={6} />
      <main className="relative overflow-hidden">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-[1120px] px-6 py-12 pb-24 lg:px-10">
          <header className="border-b border-line pb-8">
            <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[44px]">Confirm and pay</h1>
            <p className="mt-4 max-w-[46ch] text-[16px] leading-[1.6] text-ink-muted">Once payment is confirmed, {selectedQuote.name} prepares your official policy certificate; it appears in My account when issued.</p>
          </header>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-10 grid w-full gap-8 lg:grid-cols-[1fr_400px] lg:items-start">
          <section className="border border-line bg-canvas">
            <div className="border-b border-dashed border-line px-6 py-4 md:px-8">
              <Meta className="text-primary">What you are buying</Meta>
            </div>

            <dl className="grid gap-x-8 gap-y-6 p-6 sm:grid-cols-2 md:p-8">
              <Summary label="Insurer" value={selectedQuote.name} />
              <Summary label="Plan" value={selectedQuote.coverage} />
              <Summary label="Vehicle" value={vehicleDetails ? `${vehicleDetails.year || ''} ${vehicleDetails.make} ${vehicleDetails.model}`.trim() : '—'} />
              <Summary label="Plate" value={vehicleDetails?.plateNumber || '—'} />
              <Summary label="Cover period" value={policyDates ? coverPeriodLabel(policyDates) : selectedQuote.breakdown?.coverageDuration || '—'} />
              <Summary label="Premium basis" value={selectedQuote.isFinal ? 'Final quote from insurer' : 'Indicative estimate · confirmed by insurer on issue'} />
              {validity.validUntil && <Summary label="Quote validity" value={validity.label} highlight={validity.expiringSoon} />}
            </dl>

            <div className="border-t border-dashed border-line px-6 py-5 md:px-8">
              <Link to={continuation('/quotes-comparison')} className="inline-flex items-center gap-2 text-[14px] font-medium text-primary transition-colors duration-200 ease-out hover:text-[#b91c1c]">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>Choose a different insurer
              </Link>
            </div>

            <div className="border-t border-line bg-canvas-2 px-6 py-6 md:px-8">
              <Meta className="text-ink-muted">After you pay</Meta>
              <ol className="mt-5 grid gap-5 sm:grid-cols-3">
                {AFTER_PAYMENT.map((stage, index) => (
                  <li key={stage.title} className="relative border-l-2 border-primary/30 pl-4">
                    <Meta className="text-primary">{String(index + 1).padStart(2, '0')}</Meta>
                    <p className="mt-2 text-[14px] font-medium tracking-[-0.01em] text-ink">{stage.title}</p>
                    <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-muted">{stage.detail}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <aside className="overflow-hidden border border-line bg-canvas lg:sticky lg:top-24">
            <div className="border-b border-line bg-canvas-2 p-6">
              <Meta className="mb-5 block text-primary">Payment summary</Meta>
              <div className="space-y-3 text-[15px]">
                <div className="flex items-center justify-between"><span>Insurance premium</span><span className="font-semibold">{formatZMW(selectedQuote.price)}</span></div>
                {rtsaFee > 0 && <div className="flex items-center justify-between text-primary"><span>RTSA anniversary fee</span><span className="font-semibold">{formatZMW(rtsaFee)}</span></div>}
                <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[18px]"><span className="font-medium">Total</span><span className="font-semibold text-primary">{formatZMW(total)}</span></div>
              </div>
            </div>

            <form onSubmit={handlePay} className="p-6">
              <div role="tablist" aria-label="Payment method" className="mb-6 flex gap-3">
                {[['momo', 'smartphone', 'Mobile money'], ['card', 'credit_card', 'Card']].map(([id, icon, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={method === id} onClick={() => setMethod(id)} className={cn('flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[1px] border text-[14px] font-medium transition-colors duration-200 ease-out', method === id ? 'border-primary bg-primary/[0.04] text-primary' : 'border-dashed border-line-strong text-ink-muted hover:border-primary hover:text-primary')}>
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>{label}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {method === 'momo' ? (
                  <motion.div key="momo" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-4">
                    <label className="block"><span className={labelClass}>Mobile number</span><input type="tel" required autoComplete="tel" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} className={fieldClass} /></label>
                    <label className="block"><span className={labelClass}>Network</span><select required className={fieldClass}>{NETWORKS.map((network) => <option key={network}>{network}</option>)}</select></label>
                    <p className="text-[12px] text-ink-muted">You'll receive a prompt on this number to approve the payment.</p>
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

              {paymentError && <p role="alert" className="mt-4 rounded-[1px] bg-primary/[0.06] px-4 py-3 text-[13px] font-medium text-primary">{paymentError}</p>}
              <button type="submit" disabled={processing} className="group relative mt-6 flex min-h-14 w-full items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary text-[16px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint disabled:hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
                <span className={cn('material-symbols-outlined relative text-[20px]', processing && 'animate-spin')} aria-hidden="true">{processing ? 'sync' : 'lock'}</span>
                <span className="relative">{processing ? 'Processing payment…' : `Pay ${formatZMW(total)}`}</span>
              </button>
              <p className="mt-3 text-center text-[12px] text-ink-muted">Payments are processed securely. Prototype: no real charge is made.</p>
            </form>
          </aside>
        </motion.div>
        </div>
      </main>
    </>
  );
}

function Summary({ label, value, highlight = false }) {
  return (
    <div className="min-w-0">
      <dt><Meta className="text-ink-faint">{label}</Meta></dt>
      <dd className={`mt-2 break-words text-[15px] font-medium leading-[1.45] tracking-[-0.01em] ${highlight ? 'text-primary' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}

/** What the customer should expect once the money leaves their wallet. */
const AFTER_PAYMENT = [
  { title: 'Payment confirmed', detail: 'You get a receipt immediately, and it is stored on your account.' },
  { title: 'Insurer issues the policy', detail: 'The insurer prepares your certificate and cover note from this quote.' },
  { title: 'Documents in My account', detail: 'Your certificate appears under My account, ready to download.' },
];
