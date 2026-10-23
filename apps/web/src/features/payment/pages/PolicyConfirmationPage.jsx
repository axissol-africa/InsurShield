import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { useStore } from '@/store';
import { COVER_TYPE_LABELS } from '@/domain/coverGuide';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { coverPeriod } from '@/domain/coverPeriod';
import { RTSA_ANNIVERSARY_FEE } from '@/domain/rtsa';
import JourneyLayout from '@/features/quote-journey/components/JourneyLayout';
import { JOURNEY_COMPLETE } from '@/features/quote-journey/journeySteps';
import { isForeignRegistered } from '@/domain/countries';
import CoverGuideReader from '@/components/cover-guide/CoverGuideReader';
import { openDocument } from '@/lib/files';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/primitives/card';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Textarea } from '@/components/ui/primitives/textarea';
import { Label } from '@/components/ui/primitives/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/primitives/radio-group';

const ISSUE_DELAY_MS = 1500;

const coverLabel = (type) => (type === 'ThirdParty' ? 'Third party only' : 'Comprehensive');

export default function PolicyConfirmationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const captureCode = searchParams.get('capture');
  const continuation = (path) => `${path}${captureCode ? `?capture=${encodeURIComponent(captureCode)}` : ''}`;
  const { customer, quoteRequests, vehicleDetails, vehicleValue, insuranceType, premiumBreakdown, policyDates, selectedQuote, matchRtsaAnniversary, paymentReceipt, addPolicy, markNcdCodeUsed, ncdCodeValidated, resetJourney, insurerReviews, submitInsurerReview } = useStore();
  const [issuing, setIssuing] = useState(true);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [readingGuide, setReadingGuide] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const selectedCoverType = quoteRequests.find((request) => request.id === selectedQuote?.requestId)?.insuranceType || insuranceType;
  // The policy is created when payment is taken, and the receipt carries its
  // number. Deriving one here instead would show the customer a number their
  // insurer cannot find.
  const reference = (selectedQuote?.requestId || 'PENDING').slice(-6);
  const policyNumber = paymentReceipt?.policyNumber || `POL-${reference}`;
  const insurancePremium = premiumBreakdown?.finalPremium ?? selectedQuote?.price ?? 0;
  const rtsaFee = matchRtsaAnniversary ? RTSA_ANNIVERSARY_FEE : 0;
  const premium = insurancePremium + rtsaFee;
  const cover = coverPeriod(policyDates);
  const validFrom = cover.known ? cover.start : formatDate(new Date());
  const validUntil = cover.end;
  const existingReview = insurerReviews.find((review) => review.policyNumber === policyNumber && review.customerEmail === customer?.email);
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
        // The guide explains what was bought, so it belongs to the policy
        // rather than only to the quote the customer chose it from.
        coverGuide: selectedQuote.reply?.coverGuide || null,
        paymentStatus: 'Paid',
        paymentProof: paymentReceipt || { transactionId: `TXN-${selectedQuote.requestId?.slice(-6) || 'PENDING'}`, status: 'Confirmed', amount: premium, currency: 'ZMW', confirmedAt: new Date().toISOString() },
        status: 'Awaiting insurer certificate',
      });
      if (ncdCodeValidated) markNcdCodeUsed();
      setIssuing(false);
    }, ISSUE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [addPolicy, customer, insurancePremium, insuranceType, markNcdCodeUsed, matchRtsaAnniversary, ncdCodeValidated, paymentReceipt, policyDates, policyNumber, premium, rtsaFee, selectedQuote, vehicleDetails, vehicleValue]);


  if (!selectedQuote) return (
    <JourneyLayout step={JOURNEY_COMPLETE} title="Nothing to confirm yet" description="Your issued policies are available in your account.">
      <Button asChild><Link to={continuation('/account')}>Go to my account</Link></Button>
    </JourneyLayout>
  );

  const finish = () => {
    resetJourney();
    navigate(continuation('/account'));
  };

  const submitReview = async () => {
    if (!rating || !selectedQuote || !customer?.email) return;
    try {
      // Reviews are shown to other customers while they compare, so they are
      // recorded against the policy rather than kept in this browser.
      await api.policies.review(policyNumber, { rating, comment: reviewText });
      submitInsurerReview({ insurer: selectedQuote.name, policyNumber, customerEmail: customer.email, rating, comment: reviewText });
      setReviewed(true);
      setReviewError('');
    } catch (caught) {
      setReviewError(caught.message || 'Your review could not be saved. Please try again.');
    }
  };

  return (
    <>
      <JourneyLayout step={JOURNEY_COMPLETE} title="Payment received" description={`${selectedQuote.name} will prepare your official policy certificate. Your payment confirmation is not a certificate of insurance.`}>
        {issuing ? (
          <Card role="status"><CardContent>Sending your paid quote to {selectedQuote.name} for policy issue…</CardContent></Card>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3"><CardTitle><h2>Paid quote confirmation</h2></CardTitle><Badge variant="secondary">Awaiting certificate</Badge></div>
                <p className="break-all text-sm text-muted-foreground">Reference: {selectedQuote.requestId}</p>
              </CardHeader>
              <CardContent className="space-y-6">
                <dl className="grid gap-5 sm:grid-cols-2">
                  <Field label="Insurer" value={selectedQuote.name} />
                  <Field label="Cover type" value={COVER_TYPE_LABELS[selectedCoverType] || '—'} />
                  <Field label="Policyholder" value={customer?.fullName || '—'} />
                  <Field label="Contact" value={customer?.phone || customer?.email || '—'} />
                  <Field label="Vehicle" value={vehicleDetails ? `${vehicleDetails.year || ''} ${vehicleDetails.make} ${vehicleDetails.model}`.trim() : '—'} />
                  <Field label="Plate" value={vehicleDetails?.plateNumber || '—'} />
                  <Field label="Insured value" value={vehicleValue > 0 ? formatZMW(vehicleValue) : '—'} />
                  <Field label="Chassis number" value={vehicleDetails?.chassisNumber || '—'} />
                  {isForeignRegistered(vehicleDetails?.registrationCountry) && <Field label="Registered in" value={vehicleDetails.registrationCountry} />}
                  <Field label="Valid from" value={validFrom} />
                  <Field label="Valid until" value={validUntil} />
                </dl>
                <dl className="space-y-3 border-t pt-5 text-sm">
                  <div className="flex justify-between gap-4"><dt>Insurance premium ({premiumBreakdown?.coverageDuration || 'policy term'})</dt><dd className="shrink-0 font-medium">{formatZMW(insurancePremium)}</dd></div>
                  {premiumBreakdown?.ncdDiscount > 0 && <div className="flex justify-between gap-4"><dt>NCD discount ({premiumBreakdown.appliedNcdPercentage}%)</dt><dd>− {formatZMW(premiumBreakdown.ncdDiscount)}</dd></div>}
                  {rtsaFee > 0 && <div className="flex justify-between gap-4"><dt>RTSA anniversary fee</dt><dd>{formatZMW(rtsaFee)}</dd></div>}
                  <div className="flex justify-between gap-4 border-t pt-4 text-lg font-semibold"><dt>Total paid</dt><dd>{formatZMW(premium)}</dd></div>
                </dl>
                {(selectedQuote.reply?.coverGuide?.planName || selectedQuote.reply?.document) && (
                  <div className="flex flex-wrap gap-2">
                    {selectedQuote.reply?.coverGuide?.planName && <Button variant="outline" onClick={() => setReadingGuide(true)}>Cover guide</Button>}
                    {selectedQuote.reply?.document && <Button variant="outline" onClick={() => openDocument(selectedQuote.reply.document)}>Quotation</Button>}
                  </div>
                )}
              </CardContent>
              <CardFooter className="border-t text-sm text-muted-foreground">Your insurer will upload the official certificate. It will then be available in My account.</CardFooter>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle><h2>What happens next</h2></CardTitle></CardHeader>
                <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
                  <p>Track your policy in My account. Download your certificate after {selectedQuote.name} issues it.</p>
                  {selectedQuote.inspectionRules === 'REQUIRED' && <p>{selectedQuote.name} requires a vehicle inspection. They will contact you on {customer?.phone || 'your number'} to arrange it.</p>}
                  {rtsaFee > 0 && <p>Your RTSA anniversary fee is included. The road tax disc becomes available once your insurer issues the certificate.</p>}
                </CardContent>
                <CardFooter><Button className="w-full" onClick={finish}>My account</Button></CardFooter>
              </Card>
              <Card>
                <CardHeader><CardTitle><h2 id="review-heading">Rate your purchase experience</h2></CardTitle><p className="text-sm text-muted-foreground">Optional. Share your experience with {selectedQuote.name}.</p></CardHeader>
                <CardContent>
                  {reviewed || existingReview ? (
                    <p role="status" className="text-sm">Thanks — your {existingReview?.rating || rating}-star rating has been recorded.</p>
                  ) : (
                    <div className="space-y-4">
                      <RadioGroup value={rating ? String(rating) : ''} onValueChange={(value) => setRating(Number(value))} aria-label={`Rate ${selectedQuote.name} from one to five stars`} className="grid grid-cols-5 gap-1">
                        {[1, 2, 3, 4, 5].map((value) => <div key={value} className="relative min-w-0"><RadioGroupItem id={`review-${value}`} value={String(value)} className="peer sr-only" aria-label={`${value} star${value === 1 ? '' : 's'}`} /><Label htmlFor={`review-${value}`} className="flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-md border border-input text-sm peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{value}<span aria-hidden="true">★</span></Label></div>)}
                      </RadioGroup>
                      <div className="space-y-2"><Label htmlFor="purchase-review">Optional review</Label><Textarea id="purchase-review" value={reviewText} onChange={(event) => setReviewText(event.target.value)} maxLength={500} rows={3} placeholder="Tell other customers what went well" /></div>
                      {reviewError && (
                        <p role="alert" className="text-sm text-primary">{reviewError}</p>
                      )}
                      <Button variant="outline" disabled={!rating} onClick={submitReview}>Submit rating</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Button variant="ghost" onClick={() => navigate('/')}>Back to home</Button>
            </div>
          </div>
        )}
      </JourneyLayout>
      {readingGuide && <CoverGuideReader guide={selectedQuote.reply.coverGuide} insurerName={selectedQuote.name} onClose={() => setReadingGuide(false)} />}
    </>
  );
}

function Field({ label, value }) {
  return <div className="min-w-0"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>;
}
