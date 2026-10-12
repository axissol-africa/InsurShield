import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Send, TriangleAlert } from 'lucide-react';
import { calculatePremium, formatZMW } from '@/domain/premiumEngine';
import { isForeignRegistered } from '@/domain/countries';
import { COVER_TYPE_LABELS, isCoverGuideComplete } from '@/domain/coverGuide';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import { usePortalAction } from '@/features/insurer-portal/hooks/usePortalAction';
import { coverTypeOf, days, portalPath, premiumCheck, quoteOpenUntil, replyDeadline } from '@/features/insurer-portal/portal';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from '@/components/ui/primitives/field';
import { Input } from '@/components/ui/primitives/input';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/primitives/input-group';
import { Separator } from '@/components/ui/primitives/separator';
import { Spinner } from '@/components/ui/primitives/spinner';
import { Textarea } from '@/components/ui/primitives/textarea';
import { ContactLinks, DocumentPicker, Fact, FactGroup, StatusBadge } from './ui';
import { TaskOutcome, TaskPanel, TaskScreen } from './TaskScreen';

/** InsurShield's own indicative figure for this request, shown beside the insurer's premium field. */
const indicativePremium = (request, insurer, piaRatePercentage) => {
  if (!insurer || !request.vehicleValue) return 0;
  return calculatePremium({
    vehicleValueZMW: request.vehicleValue,
    insurer,
    vehicleUsage: request.vehicleUsage,
    coverageDurationId: request.coverageDurationId,
    coverageDays: request.policyDates?.anchoredToAnniversary ? request.policyDates.daysTotal : null,
    piaRatePercentage,
  }).finalPremium;
};

const PREMIUM_QUESTIONS = { low: 'less than half', high: 'more than double' };
const MAX_VALIDITY_DAYS = 30;

/** The days a quote stays open: what was typed if it is usable, the insurer's usual when nothing was. */
const validityFrom = (typed, usual) => {
  if (typed.trim() === '') return { days: usual, problem: '' };
  const days = Number(typed);
  return Number.isInteger(days) && days >= 1 && days <= MAX_VALIDITY_DAYS
    ? { days, problem: '' }
    : { days: null, problem: `Enter a whole number of days from 1 to ${MAX_VALIDITY_DAYS}.` };
};

/**
 * The insurer prices the request in its own system, then records the result
 * here in the order it was worked out: the price, the terms, the document.
 * What the customer will see builds up beside the Send button, so the figure
 * that will be charged is read back before it goes.
 */
export default function QuoteRequestForm({ request, insurer, coverGuides = {}, piaRatePercentage, defaultValidityDays, onSubmit, onBack }) {
  const quotation = useDocumentUpload();
  const quotationInput = useRef(null);
  const validityInput = useRef(null);
  const premiumInput = useRef(null);
  const [premium, setPremium] = useState('');
  const [reference, setReference] = useState('');
  const [validityDays, setValidityDays] = useState('');
  const [notes, setNotes] = useState('');
  const sending = usePortalAction(onSubmit, 'This quote could not be sent. Check your connection and try again.');

  const estimate = indicativePremium(request, insurer, piaRatePercentage);
  const coverageType = coverTypeOf(request);
  const coverLabel = COVER_TYPE_LABELS[coverageType];
  const coverGuide = coverGuides[coverageType];
  const guidePublished = isCoverGuideComplete(coverGuide);
  const deadline = replyDeadline(request);
  const { days: openDays, problem: validityProblem } = validityFrom(validityDays, defaultValidityDays);
  const premiumQuestion = PREMIUM_QUESTIONS[premiumCheck(Number(premium), estimate)];

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!guidePublished) return;
    // The browser already refuses an empty or zero premium; this holds if that check is ever bypassed.
    if (!(Number(premium) > 0)) {
      premiumInput.current?.focus();
      return;
    }
    if (validityProblem) {
      validityInput.current?.focus();
      return;
    }
    if (!quotation.document) {
      quotation.setError('Attach the final quotation from your system before sending it.');
      quotationInput.current?.focus();
      return;
    }
    void sending.run({
      premium: Number(premium),
      notes: notes.trim(),
      validityDays: openDays,
      insurerReference: reference.trim() || null,
      document: quotation.document,
      // The guide travels with the quote, so what the customer compares is
      // what this insurer had published at the moment they quoted.
      coverGuide: { ...coverGuide, coverageType },
    });
  };

  return (
    <TaskScreen
      title="Prepare quotation"
      description={<>Request <span className="font-mono text-foreground">{request.id}</span>{request.time ? ` · received ${request.time}` : ''}</>}
      onBack={onBack}
      backLabel="Back to overview"
      status={deadline && (deadline.urgent
        ? <StatusBadge tone="open" className="px-3 py-1">{deadline.label}</StatusBadge>
        : <Badge variant="outline" className="px-3 py-1">{deadline.label}</Badge>)}
      stage="quoted"
      stageNotes={{ requested: request.time }}
      reference={(
        <TaskPanel title="What the customer asked for" description="Price this in your own system exactly as declared.">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 className="text-lg font-semibold tracking-tight">{request.vehicle}</h3>
              {request.plate && <Badge variant="outline" className="font-mono">{request.plate}</Badge>}
            </div>
            <FactGroup title="Vehicle">
              <Fact label="Declared value" value={<span className="text-base font-semibold tabular-nums">{request.value}</span>} />
              <Fact label="Declared usage" value={request.usage} />
              {/* Only worth a line when it is not the home market; on a Zambian vehicle it would say nothing. */}
              {isForeignRegistered(request.registrationCountry) && <Fact wide label="Registered in" value={`${request.registrationCountry} — not on the RTSA register`} />}
            </FactGroup>
            <Separator />
            <FactGroup title="Cover requested">
              <Fact label="Cover type" value={request.coverage} />
              <Fact label="Cover period" value={`${request.period} · ${request.dates}`} />
            </FactGroup>
            <Separator />
            <FactGroup title="Customer" columns={1}>
              <Fact label="Name" value={request.client} />
              {(request.customer?.phone || request.customer?.email) && (
                <Fact label="Contact" value={<ContactLinks phone={request.customer.phone} email={request.customer.email} />} />
              )}
            </FactGroup>
            <Separator />
            <p className="flex items-center gap-2 text-sm">
              <Camera className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {request.photos ? `${request.photos} live photos attached` : 'No inspection photos were captured'}
            </p>
          </div>
        </TaskPanel>
      )}
    >
      <TaskPanel title="Your quotation" description="Record the quotation you prepared in your own system. The customer compares it with other insurers and pays the premium you enter.">
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            {/* The one thing that blocks a quote comes before any typing. */}
            {!guidePublished && (
              <Alert variant="destructive" id="cover-guide-needed">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>Publish your {coverLabel.toLowerCase()} cover guide before sending this quote.</AlertTitle>
                <AlertDescription>
                  <p>Customers compare every insurer on the same guide, so a quote cannot go out without one.</p>
                  <Button asChild variant="outline" size="sm" className="w-fit text-foreground no-underline!">
                    <Link to={portalPath.section('guides')}>Open cover guides</Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <FieldSet>
              <FieldLegend>1. Price</FieldLegend>
              <Field>
                <FieldLabel htmlFor="quote-premium">Premium on your quotation (ZMW) *</FieldLabel>
                <div className="flex gap-2">
                  <InputGroup>
                    <InputGroupAddon><InputGroupText>ZMW</InputGroupText></InputGroupAddon>
                    <InputGroupInput
                      ref={premiumInput}
                      id="quote-premium"
                      required
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="0.01"
                      value={premium}
                      onChange={(event) => setPremium(event.target.value)}
                      placeholder="e.g. 21000"
                      aria-describedby="quote-premium-hint"
                    />
                  </InputGroup>
                  {estimate > 0 && (
                    <Button type="button" variant="outline" onClick={() => setPremium(estimate.toFixed(2))} className="shrink-0">Use estimate</Button>
                  )}
                </div>
                <FieldDescription id="quote-premium-hint">
                  The customer pays exactly this amount, so it must match your quotation.
                  {estimate > 0 && <> InsurShield’s indicative estimate is {formatZMW(estimate)}.</>}
                </FieldDescription>
                <p aria-live="polite" className={premiumQuestion ? 'flex items-start gap-2 rounded-xl bg-primary/5 px-3 py-2 text-sm leading-relaxed text-foreground' : 'sr-only'}>
                  {premiumQuestion && (
                    <>
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>This is {premiumQuestion} InsurShield’s estimate of {formatZMW(estimate)}. Check it against your quotation before sending.</span>
                    </>
                  )}
                </p>
              </Field>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>2. Terms</FieldLegend>
              <FieldGroup>
                <Field data-invalid={validityProblem ? true : undefined}>
                  <FieldLabel htmlFor="quote-validity">Quote valid for (days)</FieldLabel>
                  <InputGroup className="sm:max-w-48">
                    <InputGroupInput
                      ref={validityInput}
                      id="quote-validity"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max={MAX_VALIDITY_DAYS}
                      value={validityDays}
                      onChange={(event) => setValidityDays(event.target.value)}
                      placeholder={String(defaultValidityDays)}
                      aria-invalid={validityProblem ? true : undefined}
                      aria-describedby={validityProblem ? 'quote-validity-error quote-validity-hint' : 'quote-validity-hint'}
                    />
                    <InputGroupAddon align="inline-end"><InputGroupText>days</InputGroupText></InputGroupAddon>
                  </InputGroup>
                  {validityProblem && <FieldError id="quote-validity-error">{validityProblem}</FieldError>}
                  <FieldDescription id="quote-validity-hint">
                    Leave empty for your usual {days(defaultValidityDays)}. Once it lapses the customer has to ask for new quotes; you can extend an open quote from the overview.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="quote-notes">Special conditions / notes</FieldLabel>
                  <Textarea id="quote-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. Requires tracking device installation…" aria-describedby="quote-notes-hint" />
                  <FieldDescription id="quote-notes-hint">Shown to the customer with your quote.</FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSeparator />

            <FieldSet>
              <FieldLegend>3. Quotation document</FieldLegend>
              <FieldGroup>
                <Field data-invalid={quotation.error ? true : undefined}>
                  <FieldLabel htmlFor="quotation-document">Quotation document (PDF or image) *</FieldLabel>
                  <DocumentPicker
                    id="quotation-document"
                    inputRef={quotationInput}
                    document={quotation.document}
                    onPick={quotation.pick}
                    onClear={quotation.clear}
                    error={quotation.error}
                    prompt="Attach quotation from your system"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="quote-reference">Your internal quote reference</FieldLabel>
                  <Input id="quote-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="e.g. PA-Q-2026-00412" aria-describedby="quote-reference-hint" />
                  <FieldDescription id="quote-reference-hint">Shown to the customer so they can quote it when they call you.</FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>

            <TaskOutcome title="What the customer will see">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Fact label="Plan" value={guidePublished ? coverGuide.planName : <Missing>No cover guide published</Missing>} />
                <Fact label="Premium to pay" value={Number(premium) > 0 ? <span className="text-base font-semibold tabular-nums">{formatZMW(Number(premium))}</span> : <Missing>Not entered yet</Missing>} />
                <Fact label="Open until" value={openDays ? `${quoteOpenUntil(openDays)} · ${days(openDays)}` : <Missing>Enter 1 to {MAX_VALIDITY_DAYS} days</Missing>} />
                <Fact label="Quotation document" value={quotation.document ? 'Attached' : <Missing>Not attached yet</Missing>} />
                <Fact wide label="Special conditions" value={notes.trim() || 'None'} />
              </dl>
            </TaskOutcome>

            {sending.error && (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>{sending.error}</AlertTitle>
                <AlertDescription>What you entered is still here.</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={sending.pending || !guidePublished}
              aria-busy={sending.pending}
              aria-describedby={guidePublished ? undefined : 'cover-guide-needed'}
              className="w-full"
            >
              {sending.pending ? <Spinner aria-hidden="true" /> : <Send aria-hidden="true" />}
              {sending.pending ? 'Sending…' : 'Send quote to customer'}
            </Button>
          </FieldGroup>
        </form>
      </TaskPanel>
    </TaskScreen>
  );
}

/** A part of the quote that is not there yet, said quietly: it is a reminder, not an error. */
const Missing = ({ children }) => <span className="text-muted-foreground">{children}</span>;
