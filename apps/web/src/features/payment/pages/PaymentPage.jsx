import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { useStore } from '@/store';
import { COVER_TYPE_LABELS } from '@/domain/coverGuide';
import { formatZMW } from '@/domain/premiumEngine';
import { coverPeriodLabel } from '@/domain/coverPeriod';
import { RTSA_ANNIVERSARY_FEE } from '@/domain/rtsa';
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

export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const captureCode = searchParams.get('capture');
  const continuation = (path) => `${path}${captureCode ? `?capture=${encodeURIComponent(captureCode)}` : ''}`;
  const { selectedQuote, insuranceType, quoteRequests, vehicleDetails, policyDates, customer, matchRtsaAnniversary, requoteFromRequest, recordPayment } = useStore();
  const [expiredAtPay, setExpiredAtPay] = useState(false);
  const [method, setMethod] = useState('momo');
  const [mobileNumber, setMobileNumber] = useState(customer?.phone || '');
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  if (!selectedQuote) return (
    <JourneyLayout step={6} title="Choose a quote first" description="Choose an insurer from your comparison before paying.">
      <Button asChild><Link to={continuation('/quotes-comparison')}>Back to quotes</Link></Button>
    </JourneyLayout>
  );

  const selectedCoverType = quoteRequests.find((request) => request.id === selectedQuote.requestId)?.insuranceType || insuranceType;
  const rtsaFee = matchRtsaAnniversary ? RTSA_ANNIVERSARY_FEE : 0;
  const total = selectedQuote.price + rtsaFee;
  const validity = quoteValidity(selectedQuote.validUntil ? { validUntil: selectedQuote.validUntil } : null);
  const requote = () => {
    if (selectedQuote.requestId) requoteFromRequest(selectedQuote.requestId);
    navigate(continuation('/quote-request'));
  };

  if (validity.expired || expiredAtPay) return (
    <JourneyLayout step={6} title="This quote has expired" description="Request fresh quotes before paying. Your vehicle details will be carried over.">
      <Alert className="mb-6"><AlertDescription>{selectedQuote.name}'s quote {validity.validUntil ? `was valid until ${validity.label.replace('Expired on ', '')}` : 'is no longer valid'}.</AlertDescription></Alert>
      <div className="flex flex-wrap gap-3"><Button onClick={requote}>Get fresh quotes</Button><Button variant="outline" asChild><Link to={continuation('/quotes-comparison')}>See other quotes</Link></Button></div>
    </JourneyLayout>
  );

  const handlePay = async (event) => {
    event.preventDefault();
    if (processing) return;
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
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt>Insurance premium</dt><dd className="font-medium">{formatZMW(selectedQuote.price)}</dd></div>
              {rtsaFee > 0 && <div className="flex justify-between gap-4"><dt>RTSA anniversary fee</dt><dd className="font-medium">{formatZMW(rtsaFee)}</dd></div>}
              <div className="flex justify-between gap-4 border-t pt-4 text-lg font-semibold"><dt>Total</dt><dd>{formatZMW(total)}</dd></div>
            </dl>
            <form onSubmit={handlePay} className="space-y-5">
              <Tabs value={method} onValueChange={setMethod}>
                <TabsList aria-label="Payment method" className="mb-3 w-full">
                  <TabsTrigger value="momo" disabled={processing}>Mobile money</TabsTrigger>
                  <TabsTrigger value="card" disabled={processing}>Card</TabsTrigger>
                </TabsList>
                <TabsContent value="momo" className="space-y-4">
                  <div className="space-y-2"><Label htmlFor="payment-mobile">Mobile number</Label><Input id="payment-mobile" type="tel" required autoComplete="tel" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="payment-network">Network</Label><NativeSelect id="payment-network" required className="w-full">{NETWORKS.map((network) => <option key={network}>{network}</option>)}</NativeSelect></div>
                  <p className="text-sm text-muted-foreground">You'll receive a prompt on this number to approve the payment.</p>
                </TabsContent>
                <TabsContent value="card" className="space-y-4">
                  <div className="space-y-2"><Label htmlFor="payment-card">Card number</Label><Input id="payment-card" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" required /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label htmlFor="payment-expiry">Expiry</Label><Input id="payment-expiry" autoComplete="cc-exp" placeholder="MM/YY" required /></div>
                    <div className="space-y-2"><Label htmlFor="payment-cvv">CVV</Label><Input id="payment-cvv" type="password" inputMode="numeric" autoComplete="cc-csc" placeholder="123" required /></div>
                  </div>
                </TabsContent>
              </Tabs>
              {paymentError && <Alert variant="destructive"><AlertDescription>{paymentError}</AlertDescription></Alert>}
              <Button type="submit" size="lg" disabled={processing} className="w-full">{processing ? 'Processing payment…' : `Pay ${formatZMW(total)}`}</Button>
              <p className="text-center text-xs text-muted-foreground">Prototype: no real charge is made.</p>
            </form>
          </CardContent>
        </Card>
      </div>
    </JourneyLayout>
  );
}

function Summary({ label, value }) {
  return <div className="min-w-0"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>;
}
