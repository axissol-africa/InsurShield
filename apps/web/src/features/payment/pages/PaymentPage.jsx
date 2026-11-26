import { env } from '@/config/env';
import PaymentHeld from '../components/PaymentHeld';
import { isHeldPayment } from '../paymentStatus';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { newIdempotencyKey } from '@/api/shared';
import { getIdentityBinding } from '@/app/identity';
import { useStore } from '@/store';
import { COVER_TYPE_LABELS } from '@/domain/coverGuide';
import { formatZMW } from '@/domain/premiumEngine';
import { coverPeriodLabel } from '@/domain/coverPeriod';
import { quoteValidity } from '@/domain/quoteValidity';
import JourneyLayout from '@/features/quote-journey/components/JourneyLayout';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/primitives/card';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { Label } from '@/components/ui/primitives/label';
import { NativeSelect } from '@/components/ui/primitives/native-select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/primitives/tabs';
import { Alert, AlertDescription } from '@/components/ui/primitives/alert';

const NETWORKS = ['MTN Mobile Money', 'Airtel Money', 'Zamtel Kwacha'];
const OPEN = ['Initiated', 'Pending'];
const ENDED = ['Failed', 'Cancelled', 'Expired', 'Reversed'];
/** How often the waiting page asks the server where the payment stands. */
export const POLL_MS = 3000;

export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const captureCode = searchParams.get('capture');
  const continuation = (path) => `${path}${captureCode ? `?capture=${encodeURIComponent(captureCode)}` : ''}`;
  const { selectedQuote, insuranceType, quoteRequests, vehicleDetails, policyDates, customer, requoteFromRequest, recordPayment, paymentReceipt, paymentAttempt, setPaymentAttempt } = useStore();
  const pendingStart = paymentAttempt && !paymentAttempt.transactionId && paymentAttempt.insurerQuoteId === selectedQuote?.insurerQuoteId
    ? paymentAttempt : null;
  const lockedDetails = pendingStart?.payload;
  const [expiredAtPay, setExpiredAtPay] = useState(false);
  const [method, setMethod] = useState('momo');
  const [mobileNumber, setMobileNumber] = useState(customer?.phone || '');
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  // The server's own figures when it disagreed with the page, so the customer pays what it expects.
  const [serverAmount, setServerAmount] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  // The attempt being followed: only one for the quote on this page, whether just started or back from card checkout.
  const attempt = paymentAttempt?.transactionId && paymentAttempt.insurerQuoteId === selectedQuote?.insurerQuoteId ? paymentAttempt : null;
  const payment = attempt?.payment ?? null;
  const unresolvedPayment = payment || paymentAttempt?.payment || paymentReceipt;
  const heldReceipt = env.apiMode === 'http' && isHeldPayment(unresolvedPayment) ? unresolvedPayment : null;
  const waiting = Boolean(payment && OPEN.includes(payment.status));

  useEffect(() => {
    if ((!waiting && !heldReceipt) || !attempt?.transactionId) return undefined;
    let current = true;
    const timer = setInterval(async () => {
      try {
        const latest = await api.payments.status(attempt.transactionId);
        if (current && latest) setPaymentAttempt({ ...attempt, payment: latest });
      } catch {
        // A missed check is retried on the next tick; the server keeps the attempt either way.
      }
    }, POLL_MS);
    return () => { current = false; clearInterval(timer); };
  }, [waiting, heldReceipt, attempt, setPaymentAttempt]);

  useEffect(() => {
    if (payment?.status !== 'Confirmed' || (env.apiMode === 'http' && !payment.policyNumber)) return;
    recordPayment(payment);
    setPaymentAttempt(null);
    navigate(`/confirmation${captureCode ? `?capture=${encodeURIComponent(captureCode)}` : ''}`, { replace: true });
  }, [payment, recordPayment, setPaymentAttempt, navigate, captureCode]);

  if (heldReceipt) return <PaymentHeld receipt={heldReceipt} />;

  if (!selectedQuote) return (
    <JourneyLayout step={6} title="Choose a quote first" description="Choose an insurer from your comparison before paying.">
      <Button asChild><Link to={continuation('/quotes-comparison')}>Back to quotes</Link></Button>
    </JourneyLayout>
  );

  const selectedRequest = quoteRequests.find((request) => request.id === selectedQuote.requestId);
  const selectedCoverType = selectedRequest?.insuranceType || insuranceType;
  const rtsaFee = selectedRequest?.rtsaAnniversaryFee ?? 0;
  const lines = payment?.breakdown ?? serverAmount?.breakdown ?? null;
  const addOns = selectedQuote.addOns || [];
  const addOnsTotal = addOns.reduce((sum, addOn) => sum + addOn.price, 0);
  const total = payment?.amount ?? lockedDetails?.amount ?? serverAmount?.expected ?? Math.round((selectedQuote.price + addOnsTotal + rtsaFee) * 100) / 100;
  const validity = quoteValidity(selectedQuote.validUntil ? { validUntil: selectedQuote.validUntil } : null);
  const requote = () => {
    if (selectedQuote.requestId) requoteFromRequest(selectedQuote.requestId);
    navigate(continuation('/quote-request'));
  };

  if (!payment && !pendingStart && (validity.expired || expiredAtPay)) return (
    <JourneyLayout step={6} title="This quote has expired" description="Request fresh quotes before paying. Your vehicle details will be carried over.">
      <Alert className="mb-6"><AlertDescription>{selectedQuote.name}'s quote {validity.validUntil ? `was valid until ${validity.label.replace('Expired on ', '')}` : 'is no longer valid'}.</AlertDescription></Alert>
      <div className="flex flex-wrap gap-3"><Button onClick={requote}>Get fresh quotes</Button><Button variant="outline" asChild><Link to={continuation('/quotes-comparison')}>See other quotes</Link></Button></div>
    </JourneyLayout>
  );

  const handlePay = async (event) => {
    event.preventDefault();
    if (processing || waiting) return;
    // Re-check at the moment of authorisation; a quote valid now stays purchasable while confirmation is pending.
    if (!pendingStart && quoteValidity(selectedQuote.validUntil ? { validUntil: selectedQuote.validUntil } : null).expired) { setExpiredAtPay(true); return; }
    setProcessing(true);
    setPaymentError('');
    // A retry after a lost answer sends the same key, so the server finds the attempt it already started.
    const idempotencyKey = pendingStart?.idempotencyKey || newIdempotencyKey();
    const payload = lockedDetails ?? {
      quoteRequestId: selectedQuote.requestId,
      insurerQuoteId: selectedQuote.insurerQuoteId,
      amount: total,
      method: method === 'momo' ? 'Mobile money' : 'Card',
      ...(method === 'momo' && { mobileNumber }),
      ...(method === 'card' && { returnUrl: `${window.location.origin}${continuation('/payment')}` }),
    };
    const identity = getIdentityBinding() || customer?.id || customer?.email;
    const stillOnAttempt = () => {
      const current = useStore.getState();
      const currentIdentity = getIdentityBinding() || current.customer?.id || current.customer?.email;
      return !current.leaving && identity === currentIdentity && current.paymentAttempt?.idempotencyKey === idempotencyKey;
    };
    setPaymentAttempt({ insurerQuoteId: selectedQuote.insurerQuoteId, idempotencyKey, payload, transactionId: null, payment: null });
    try {
      const started = await api.payments.pay(payload, idempotencyKey);
      if (!stillOnAttempt()) return;
      setPaymentAttempt({ insurerQuoteId: selectedQuote.insurerQuoteId, idempotencyKey, transactionId: started.transactionId, payment: started });
      setServerAmount(null);
      setProcessing(false);
      // Card details are entered on the provider's own page, never here.
      if (started.checkoutUrl && OPEN.includes(started.status)) window.location.assign(started.checkoutUrl);
    } catch (caught) {
      if (!stillOnAttempt()) return;
      if (caught?.code === 'AMOUNT_MISMATCH' && caught.details?.expected) {
        setProcessing(false);
        setPaymentAttempt(null);
        setServerAmount({ expected: caught.details.expected, breakdown: caught.details.breakdown ?? null });
        setPaymentError(`The amount to pay is now ${formatZMW(caught.details.expected)}. Check the summary and pay again.`);
        return;
      }
      const followExisting = ['PAYMENT_IN_PROGRESS', 'ALREADY_PAID'].includes(caught?.code) && caught.details?.transactionId;
      if (followExisting) {
        // Another tab or device already started one: follow that one instead of starting another.
        const existing = await api.payments.status(caught.details.transactionId).catch(() => null);
        if (!stillOnAttempt()) return;
        if (existing) {
          setPaymentAttempt({ insurerQuoteId: selectedQuote.insurerQuoteId, idempotencyKey, transactionId: existing.transactionId, payment: existing });
          setProcessing(false);
          return;
        }
      }
      // Only a lost answer keeps the key for the retry; a refusal starts afresh.
      if (!followExisting && caught?.code && caught.code !== 'NETWORK' && !(caught.status >= 500)) {
        setPaymentAttempt(null);
        if (caught.code === 'QUOTE_EXPIRED') setExpiredAtPay(true);
      }
      setProcessing(false);
      setPaymentError(caught?.message || 'The payment could not be completed. Please try again.');
    }
  };

  const cancelPayment = async () => {
    setCancelling(true);
    try {
      const stopped = await api.payments.cancel(attempt.transactionId);
      setPaymentAttempt({ ...attempt, payment: stopped });
    } catch (caught) {
      setPaymentError(caught?.message || 'The payment could not be stopped. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  const tryAgain = () => {
    setPaymentAttempt(null);
    setPaymentError('');
  };

  if (payment && (waiting || ENDED.includes(payment.status))) return (
    <JourneyLayout step={6} title={waiting ? 'Waiting for your payment' : 'Payment not completed'} description={`${selectedQuote.name}, ${formatZMW(payment.amount)}`}>
      <Card className="max-w-xl">
        <CardContent className="space-y-4 pt-6">
          <div role="status" aria-live="polite" className="space-y-2">
            {waiting && payment.method === 'Mobile money' && <p className="font-medium">Approve the payment prompt sent to {payment.payer || 'your phone'}.</p>}
            {waiting && payment.method !== 'Mobile money' && <p className="font-medium">Finish the payment on the provider's page. This page updates when it is done.</p>}
            {waiting && <p className="text-sm text-muted-foreground">{pastDeadline(payment) ? 'This is taking longer than usual. We are still checking with the provider.' : 'This page updates on its own once the provider tells us.'}</p>}
            {!waiting && <p className="font-medium">{payment.failure || 'The payment did not go through. No money was taken.'}</p>}
          </div>
          {lines && <Breakdown lines={lines} total={payment.amount} />}
          {paymentError && <Alert variant="destructive"><AlertDescription>{paymentError}</AlertDescription></Alert>}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3 border-t">
          {waiting && payment.checkoutUrl && <Button onClick={() => window.location.assign(payment.checkoutUrl)}>Go to the payment page</Button>}
          {waiting && <Button variant="outline" disabled={cancelling} onClick={cancelPayment}>{cancelling ? 'Stopping…' : 'Cancel this payment'}</Button>}
          {!waiting && payment.status !== 'Reversed' && <Button onClick={tryAgain}>Try again</Button>}
          {!waiting && <Button variant="outline" asChild><Link to={continuation('/quotes-comparison')}>Back to quotes</Link></Button>}
        </CardFooter>
      </Card>
    </JourneyLayout>
  );

  return (
    <JourneyLayout step={6} title="Confirm and pay" description={`After payment, ${selectedQuote.name} prepares your official certificate. It will be available in My account once issued.`}>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader><CardTitle><h2>Your selected quote</h2></CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-6 sm:grid-cols-2">
              <Summary label="Insurer" value={selectedQuote.name} />
              <Summary label="Cover type" value={COVER_TYPE_LABELS[selectedCoverType] || '—'} />
              <Summary label="Vehicle" value={vehicleDetails ? `${vehicleDetails.year || ''} ${vehicleDetails.make} ${vehicleDetails.model}`.trim() : '—'} />
              <Summary label="Plate" value={vehicleDetails?.plateNumber || '—'} />
              <Summary label="Cover period" value={policyDates ? coverPeriodLabel(policyDates) : selectedQuote.breakdown?.coverageDuration || '—'} />
              <Summary label="Premium basis" value={selectedQuote.isFinal ? 'Final quote from insurer' : 'Indicative estimate · confirmed by insurer on issue'} />
              {validity.validUntil && <Summary label="Quote validity" value={validity.label} />}
            </dl>
          </CardContent>
          <CardFooter className="border-t"><Button variant="outline" asChild><Link to={continuation('/quotes-comparison')}>Choose a different insurer</Link></Button></CardFooter>
        </Card>
        <Card>
          <CardHeader><CardTitle><h2>Payment summary</h2></CardTitle></CardHeader>
          <CardContent className="space-y-6">
            {lines ? <Breakdown lines={lines} total={total} /> : (
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-4"><dt>Insurance premium</dt><dd className="font-medium">{formatZMW(selectedQuote.price)}</dd></div>
                {addOns.map((addOn) => <div key={addOn.code} className="flex justify-between gap-4"><dt>{addOn.label}</dt><dd className="font-medium">{formatZMW(addOn.price)}</dd></div>)}
                {rtsaFee > 0 && <div className="flex justify-between gap-4"><dt>RTSA anniversary fee</dt><dd className="font-medium">{formatZMW(rtsaFee)}</dd></div>}
                <div className="flex justify-between gap-4 border-t pt-4 text-lg font-semibold"><dt>Total</dt><dd>{formatZMW(total)}</dd></div>
              </dl>
            )}
            <form onSubmit={handlePay} className="space-y-5">
              <Tabs value={lockedDetails ? (lockedDetails.method === 'Card' ? 'card' : 'momo') : method} onValueChange={setMethod}>
                <TabsList aria-label="Payment method" className="mb-3 w-full">
                  <TabsTrigger value="momo" disabled={processing || !!lockedDetails}>Mobile money</TabsTrigger>
                  <TabsTrigger value="card" disabled={processing || !!lockedDetails}>Card</TabsTrigger>
                </TabsList>
                <TabsContent value="momo" className="space-y-4">
                  <div className="space-y-2"><Label htmlFor="payment-mobile">Mobile number</Label><Input id="payment-mobile" type="tel" required autoComplete="tel" disabled={!!lockedDetails} value={lockedDetails?.mobileNumber ?? mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="payment-network">Network</Label><NativeSelect id="payment-network" required disabled={!!lockedDetails} className="w-full">{NETWORKS.map((network) => <option key={network}>{network}</option>)}</NativeSelect></div>
                  <p className="text-sm text-muted-foreground">You'll receive a prompt on this number to approve the payment.</p>
                </TabsContent>
                <TabsContent value="card" className="space-y-4">
                  <p className="text-sm text-muted-foreground">You'll enter your card on the payment provider's secure page. InsurShield never sees your card details.</p>
                </TabsContent>
              </Tabs>
              {paymentError && <Alert variant="destructive"><AlertDescription>{paymentError}</AlertDescription></Alert>}
              {lockedDetails && !processing && <p className="text-sm text-muted-foreground">Retry using the original details to recover this payment.</p>}
              <Button type="submit" size="lg" disabled={processing} className="w-full">{processing ? 'Starting payment…' : lockedDetails ? 'Retry original payment' : `Pay ${formatZMW(total)}`}</Button>
              <p className="text-center text-xs text-muted-foreground">Test payments only: no real money is taken.</p>
            </form>
          </CardContent>
        </Card>
      </div>
    </JourneyLayout>
  );
}

/** Past its deadline, the server still settles the attempt; the page only says so. */
const pastDeadline = (payment) => Boolean(payment.pendingUntil) && Date.now() > new Date(payment.pendingUntil).getTime();

/** The server's itemised amount: premium, each chosen add-on and each approved charge. */
function Breakdown({ lines, total }) {
  return (
    <dl className="space-y-3 text-sm">
      {lines.map((line) => (
        <div key={`${line.kind}-${line.code}`} className="flex justify-between gap-4"><dt>{line.kind === 'PREMIUM' ? 'Insurance premium' : line.label}</dt><dd className="font-medium">{formatZMW(line.amount)}</dd></div>
      ))}
      <div className="flex justify-between gap-4 border-t pt-4 text-lg font-semibold"><dt>Total</dt><dd>{formatZMW(total)}</dd></div>
    </dl>
  );
}

function Summary({ label, value }) {
  return <div className="min-w-0"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>;
}
