import { useRef, useState } from 'react';
import { BadgeCheck, CircleCheck, ExternalLink, TriangleAlert } from 'lucide-react';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { coverPeriod } from '@/domain/coverPeriod';
import { openDocument } from '@/lib/files';
import { timeAgo } from '@/lib/time';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import { usePortalAction } from '@/features/insurer-portal/hooks/usePortalAction';
import { policyPaidAt } from '@/features/insurer-portal/portal';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/primitives/field';
import { Input } from '@/components/ui/primitives/input';
import { NativeSelect } from '@/components/ui/primitives/native-select';
import { Textarea } from '@/components/ui/primitives/textarea';
import { Separator } from '@/components/ui/primitives/separator';
import { Spinner } from '@/components/ui/primitives/spinner';
import { ContactLinks, DocumentPicker, Fact, FactGroup, StatusBadge } from './ui';
import { TaskOutcome, TaskPanel, TaskScreen } from './TaskScreen';

const Reference = ({ children }) => <span className="font-mono text-foreground">{children}</span>;

/** Why a paid policy cannot be issued. The customer reads the message, not the code. */
const ISSUANCE_FAILURE_REASONS = [
  ['RISK_NOT_ACCEPTED', 'We cannot accept this risk'],
  ['VEHICLE_DETAILS_WRONG', 'The vehicle details do not match'],
  ['DOCUMENTS_MISSING', 'Documents we need are missing'],
  ['DUPLICATE_COVER', 'The vehicle is already covered'],
  ['OTHER', 'Another reason'],
];

/** When issuing is due, and whether the customer is already waiting longer than promised. */
function issuanceLine(policy) {
  const issuance = policy.issuance || {};
  if (issuance.overdue) return `Overdue since ${formatDate(issuance.dueAt)}`;
  if (issuance.dueAt) return `Due by ${formatDate(issuance.dueAt)}`;
  return null;
}

/**
 * The customer has paid and has no cover document yet. The insurer checks
 * what was bought and that the money arrived, then uploads the certificate
 * that makes the policy active.
 */
export default function PolicyIssuePanel({ policy, onBack, onIssued, onAccept, onFail }) {
  const certificate = useDocumentUpload();
  const certificateInput = useRef(null);
  const [insurerPolicyNumber, setInsurerPolicyNumber] = useState(policy.insurerPolicyNumber || '');
  const issuing = usePortalAction(onIssued, 'This policy could not be issued. Check your connection and try again.');
  const proof = policy.paymentProof || {};
  const paidAt = policyPaidAt(policy);
  const paid = timeAgo(paidAt);
  const period = coverPeriod(policy.policyDates);
  const customer = policy.customerName || 'The customer';
  const accepting = usePortalAction(onAccept, 'This policy could not be accepted. Check your connection and try again.');
  const accepted = policy.issuance?.acceptedAt;
  const due = issuanceLine(policy);

  const submit = (event) => {
    event.preventDefault();
    if (!certificate.document) {
      certificate.setError('Upload the official policy certificate before issuing the active policy.');
      certificateInput.current?.focus();
      return;
    }
    void issuing.run(policy.policyNumber, { certificateDocument: certificate.document, insurerPolicyNumber: insurerPolicyNumber.trim() });
  };

  return (
    <TaskScreen
      title="Issue policy certificate"
      description={<>Policy <Reference>{policy.policyNumber}</Reference>{policy.quoteRequestId && <> · from request <Reference>{policy.quoteRequestId}</Reference></>}</>}
      onBack={onBack}
      backLabel="Back to paid policies"
      status={(
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="open" className="px-3 py-1">{paid ? `Paid ${paid} · waiting for cover` : 'Paid · waiting for cover'}</StatusBadge>
          {due && <StatusBadge tone="open" className="px-3 py-1">{due}</StatusBadge>}
        </div>
      )}
      stage="issued"
      stageNotes={{ paid: paid || undefined }}
      reference={(
        <TaskPanel title="What the customer bought" description="The certificate you upload must match this.">
          <div className="space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-lg font-semibold tracking-tight">{policy.plan || policy.coverage || 'Policy cover'}</h3>
              <p className="text-lg font-semibold tabular-nums">{formatZMW(policy.premium || 0)}</p>
            </div>
            <FactGroup title="Cover">
              <Fact label="Vehicle" value={<>{policy.vehicle} {policy.vehicleDetails?.plateNumber && <Badge variant="outline" className="ml-1 font-mono">{policy.vehicleDetails.plateNumber}</Badge>}</>} />
              <Fact label="Cover type" value={policy.coverage || '—'} />
              <Fact label="Cover period" value={period.known ? `${period.start} – ${period.end}` : 'Not supplied with this policy'} />
              {policy.insurerQuoteReference && <Fact label="Your quote reference" value={<Reference>{policy.insurerQuoteReference}</Reference>} />}
            </FactGroup>
            {policy.quoteDocument && (
              <Button type="button" variant="outline" size="sm" onClick={() => openDocument(policy.quoteDocument)} className="max-w-full">
                <ExternalLink aria-hidden="true" />
                <span className="truncate">View the quotation you sent</span>
              </Button>
            )}
            <Separator />
            <FactGroup title="Customer" columns={1}>
              <Fact label="Name" value={policy.customerName || '—'} />
              {(policy.customerPhone || policy.customerEmail) && <Fact label="Contact" value={<ContactLinks phone={policy.customerPhone} email={policy.customerEmail} />} />}
            </FactGroup>
            <Separator />
            {/* Payment is verified before a certificate is ever requested. */}
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">Payment</h3>
                <Badge variant="secondary"><CircleCheck aria-hidden="true" />{proof.status || 'Confirmed'}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {policy.paymentProof ? 'The gateway confirmed this payment before the policy reached you.' : 'This policy reached you as paid; its payment record was not supplied with it.'}
              </p>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Fact label="Transaction reference" value={proof.transactionId ? <span className="font-mono">{proof.transactionId}</span> : 'Not supplied'} />
                <Fact label="Payment method" value={proof.method || 'Payment gateway'} />
                <Fact label="Amount confirmed" value={<span className="tabular-nums">{formatZMW(proof.amount || policy.premium || 0)}</span>} />
                <Fact label="Paid on" value={paidAt ? formatDate(paidAt) : 'Not supplied'} />
              </dl>
            </section>
          </div>
        </TaskPanel>
      )}
    >
      {onAccept && (
        <TaskPanel title="Accept for issuing" description="Tell the customer you have the policy in hand. You can upload the certificate later.">
          {accepted ? (
            <p role="status" className="text-sm">Accepted {timeAgo(accepted) || 'just now'}. Upload the certificate when it is ready.</p>
          ) : (
            <div className="space-y-3">
              <Button type="button" variant="outline" disabled={accepting.pending} aria-busy={accepting.pending} onClick={() => accepting.run(policy.policyNumber, insurerPolicyNumber.trim())}>
                {accepting.pending ? <Spinner aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                Accept for issuing
              </Button>
              {accepting.error && <p role="alert" className="text-sm text-destructive">{accepting.error}</p>}
            </div>
          )}
        </TaskPanel>
      )}
      <TaskPanel title="Your certificate" description="Issue the policy in your own system, then upload the certificate it produced.">
        <form onSubmit={submit}>
          <FieldGroup>
            <Field data-invalid={certificate.error ? true : undefined}>
              <FieldLabel htmlFor="policy-certificate">Official policy certificate *</FieldLabel>
              <DocumentPicker
                id="policy-certificate"
                inputRef={certificateInput}
                document={certificate.document}
                onPick={certificate.pick}
                onClear={certificate.clear}
                error={certificate.error}
                prompt="Upload certificate from your system"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="insurer-policy-number">Your policy number</FieldLabel>
              <Input
                id="insurer-policy-number"
                value={insurerPolicyNumber}
                onChange={(event) => setInsurerPolicyNumber(event.target.value)}
                placeholder="e.g. PA-2026-00412"
                aria-describedby="insurer-policy-number-hint"
                className="sm:max-w-sm"
              />
              <FieldDescription id="insurer-policy-number-hint">Optional. The number this policy carries in your own system; left empty, the InsurShield policy number is used.</FieldDescription>
            </Field>

            <TaskOutcome title="What happens when you issue">
              <ul className="space-y-2 text-sm leading-relaxed">
                <Consequence><Reference>{policy.policyNumber}</Reference> becomes active{period.known ? `, covering ${period.start} – ${period.end}` : ''}.</Consequence>
                <Consequence>{customer} can open the certificate from their account straight away.</Consequence>
                <Consequence>The policy moves to your issued list. A certificate cannot be replaced from this screen, so check the file first.</Consequence>
              </ul>
            </TaskOutcome>

            {issuing.error && (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>{issuing.error}</AlertTitle>
                <AlertDescription>Your file is still attached.</AlertDescription>
              </Alert>
            )}

            <Button type="submit" size="lg" disabled={issuing.pending} aria-busy={issuing.pending} className="h-auto min-h-10 w-full whitespace-normal py-2">
              {issuing.pending ? <Spinner aria-hidden="true" /> : <BadgeCheck aria-hidden="true" />}
              {issuing.pending ? 'Issuing policy…' : 'Issue active policy & send certificate'}
            </Button>
          </FieldGroup>
        </form>
      </TaskPanel>
      {onFail && <IssuanceFailure policy={policy} customer={customer} onFail={onFail} />}
    </TaskScreen>
  );
}

/**
 * The insurer cannot issue what the customer paid for. The customer is told in
 * the insurer's words and refunded; the policy cannot be issued afterwards.
 */
function IssuanceFailure({ policy, customer, onFail }) {
  const [open, setOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [message, setMessage] = useState('');
  const failing = usePortalAction(onFail, 'The failure could not be recorded. Check your connection and try again.');
  const ready = reasonCode && message.trim().length >= 10;
  if (!open) {
    return (
      <TaskPanel title="Cannot issue this policy?" description="Only when you cannot cover what the customer bought. They will be refunded.">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>Report that it cannot be issued</Button>
      </TaskPanel>
    );
  }
  return (
    <TaskPanel title="Report that it cannot be issued" description={`${customer} is told your reason and refunded. The policy cannot be issued after this.`}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void failing.run(policy.policyNumber, { reasonCode, customerMessage: message.trim() });
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="issuance-failure-reason">Reason *</FieldLabel>
            <NativeSelect id="issuance-failure-reason" required value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} className="w-full">
              <option value="">Choose a reason</option>
              {ISSUANCE_FAILURE_REASONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="issuance-failure-message">What to tell the customer *</FieldLabel>
            <Textarea id="issuance-failure-message" rows={3} maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} aria-describedby="issuance-failure-hint" />
            <FieldDescription id="issuance-failure-hint">Shown to the customer as you write it. At least 10 characters.</FieldDescription>
          </Field>
          {failing.error && <p role="alert" className="text-sm text-destructive">{failing.error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={!ready || failing.pending} aria-busy={failing.pending}>
              {failing.pending && <Spinner aria-hidden="true" />}Report and refund the customer
            </Button>
            <Button type="button" variant="ghost" disabled={failing.pending} onClick={() => setOpen(false)}>Back</Button>
          </div>
        </FieldGroup>
      </form>
    </TaskPanel>
  );
}

const Consequence = ({ children }) => (
  <li className="flex items-start gap-2">
    <CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span>{children}</span>
  </li>
);
