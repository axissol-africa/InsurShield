import { useState } from 'react';
import { motion } from 'framer-motion';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { coverPeriodLabel } from '@/domain/coverPeriod';
import { openDocument } from '@/lib/files';
import { downloadPolicyCertificate } from '@/lib/policyDocuments';
import { timeAgo } from '@/lib/time';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import Meta from '@/components/ui/Meta';
import { BackButton, DocumentPicker, EmptyState, Fact, Icon, outlineButtonClass, primaryButtonClass } from './ui';
import { fieldClass as inputClass, labelClass as fieldLabelClass } from '@/components/ui/field';

const coverPeriod = (policy) => coverPeriodLabel(policy.policyDates);

/**
 * Paid quotes waiting for the insurer's official certificate, plus the
 * policies already issued. Each item links back to the customer's quote request.
 */
export default function PaidPoliciesTab({ policies, onIssue }) {
  return (
    <section>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-4">
            <Meta className="text-primary">Paid policy delivery</Meta>
            <span className="h-px w-12 bg-line" aria-hidden="true" />
          </div>
          <p className="mt-3 max-w-xl text-[13px] leading-[1.55] text-ink-muted">
            Each item is linked to the exact quote request your team sent to the customer.
          </p>
        </div>
        <Meta className="shrink-0 text-ink-faint">
          {policies.length} paid {policies.length === 1 ? 'policy' : 'policies'} received
        </Meta>
      </div>

      {policies.length === 0 ? (
        <EmptyState
          icon="verified_user"
          title="No paid policies received yet"
          hint="When a customer pays for your accepted quote, the paid request appears here for your team to issue the official certificate."
        />
      ) : (
        <div className="space-y-5">
          {policies.map((policy) => (
            <PaidPolicyCard key={policy.policyNumber} policy={policy} onIssue={() => onIssue(policy)} />
          ))}
        </div>
      )}
    </section>
  );
}

function PaidPolicyCard({ policy, onIssue }) {
  const issued = policy.status === 'Active';

  return (
    <article className={`border ${issued ? 'border-line' : 'ticked border-primary'}`}>
      {/* Reference header: what this is, and which request it came from. */}
      <div className="flex flex-col gap-4 border-b border-dashed border-line p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Meta className="text-ink-muted">{issued ? 'Official policy issued' : 'Paid quote received'}</Meta>
          <h3 className="mt-3 font-mono text-[20px] tracking-[0.02em] text-primary">{policy.policyNumber}</h3>
          <p className="mt-2 text-[13px] text-ink-muted">
            Paid quote request:{' '}
            <span className="font-mono text-ink">
              {policy.quoteRequestId || 'Legacy policy — quote reference unavailable'}
            </span>
          </p>
        </div>
        <span
          className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-[1px] border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] ${
            issued ? 'border-line-strong text-ink-muted' : 'border-primary bg-primary text-white'
          }`}
        >
          <Icon name={issued ? 'task_alt' : 'pending_actions'} className="text-[15px]" />
          {issued ? 'Paid · Active' : 'Paid · Awaiting issue'}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label="Customer"
          value={<>{policy.customerName || 'Customer'}<span className="mt-1 block text-[12px] text-ink-muted">{policy.customerPhone || policy.customerEmail || 'Contact not supplied'}</span></>}
        />
        <Fact
          label="Vehicle"
          value={<>{policy.vehicle || 'Vehicle'}<span className="mt-1 block font-mono text-[12px] text-ink-muted">{policy.vehicleDetails?.plateNumber || 'Plate not supplied'}</span></>}
        />
        <Fact
          label="Cover period"
          value={<>{coverPeriod(policy)}<span className="mt-1 block text-[12px] text-ink-muted">{policy.coverage || policy.plan || 'Policy cover'}</span></>}
        />
        <Fact
          label="Premium paid"
          value={<><span className="text-[18px] font-semibold tracking-[-0.02em] text-primary">{formatZMW(policy.premium || 0)}</span><span className="mt-1 block text-[12px] text-ink-muted">Received {timeAgo(policy.receivedAt || policy.issuedAt) || 'just now'}</span></>}
        />
      </dl>

      {/* The action this card exists for. */}
      <div className="mx-5 mb-5 flex flex-col gap-4 border border-dashed border-line-strong p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Icon name="description" className="text-[20px] text-primary" />
          <div>
            <p className="text-[13px] font-medium text-ink">
              {issued ? 'Official policy certificate' : 'Official certificate required'}
            </p>
            <p className="mt-1 text-[12px] leading-[1.5] text-ink-muted">
              {issued
                ? 'Available to the customer in My account.'
                : 'Review the paid quote, then upload the certificate from your insurer system.'}
            </p>
          </div>
        </div>
        {!issued && (
          <button type="button" onClick={onIssue} className={`${primaryButtonClass} shrink-0`}>
            <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
            <Icon name="edit_document" className="relative text-[16px]" />
            <span className="relative">Review &amp; issue policy</span>
          </button>
        )}
        {issued && policy.certificateDocument && (
          <button type="button" onClick={() => openDocument(policy.certificateDocument)} className={`${outlineButtonClass} shrink-0`}>
            <Icon name="open_in_new" className="text-[16px]" />View certificate
          </button>
        )}
        {issued && !policy.certificateDocument && (
          <button type="button" onClick={() => downloadPolicyCertificate(policy)} className={`${outlineButtonClass} shrink-0`}>
            <Icon name="download" className="text-[16px]" />Download certificate
          </button>
        )}
      </div>

      {policy.insurerQuoteReference && (
        <p className="mx-5 mb-5 border-t border-dashed border-line pt-4 text-[12px] text-ink-muted">
          Your quote reference: <span className="font-mono text-ink">{policy.insurerQuoteReference}</span>
        </p>
      )}
    </article>
  );
}

/** Review the paid quote and payment, then upload the certificate that activates the policy. */
export function PolicyIssuePanel({ policy, onBack, onIssued }) {
  const certificate = useDocumentUpload();
  const [insurerPolicyNumber, setInsurerPolicyNumber] = useState(policy.insurerPolicyNumber || '');
  const proof = policy.paymentProof || {};

  const submit = (event) => {
    event.preventDefault();
    if (!certificate.document) {
      certificate.setError('Upload the official policy certificate before issuing the active policy.');
      return;
    }
    onIssued(policy.policyNumber, { certificateDocument: certificate.document, insurerPolicyNumber: insurerPolicyNumber.trim() });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full pb-10">
      <div className="mb-8 flex items-center gap-4 border-b border-line pb-7">
        <BackButton onClick={onBack} />
        <div>
          <Meta className="text-ink-muted">Paid policy received</Meta>
          <h2 className="mt-3 text-[24px] font-semibold tracking-[-0.03em] text-ink">
            Issue policy for <span className="font-mono text-primary">{policy.quoteRequestId}</span>
          </h2>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── What was paid for ──────────────────────────────────── */}
        <section className="border border-line p-6">
          <div className="border-b border-dashed border-line pb-4">
            <Meta className="text-primary">Paid quote in full</Meta>
            <p className="mt-3 font-mono text-[12px] text-ink-faint">
              {policy.quoteRequestId} · {policy.insurerQuoteReference || 'No insurer quote reference'}
            </p>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
            <Fact label="Customer" value={<>{policy.customerName}<span className="mt-1 block text-[12px] text-ink-muted">{policy.customerPhone}<br />{policy.customerEmail}</span></>} />
            <Fact label="Vehicle" value={<>{policy.vehicle}<span className="mt-1 block font-mono text-[12px] text-ink-muted">{policy.vehicleDetails?.plateNumber || '—'}</span></>} />
            <Fact label="Cover" value={<>{policy.plan || policy.coverage}<span className="mt-1 block text-[12px] text-ink-muted">{policy.coverage}</span></>} />
            <Fact label="Premium paid" value={<span className="text-[18px] font-semibold tracking-[-0.02em] text-primary">{formatZMW(policy.premium || 0)}</span>} />
            <Fact label="Cover period" value={coverPeriod(policy)} wide />
          </dl>

          {/* Payment is verified before a certificate is ever requested. */}
          <div className="mt-6 border border-dashed border-line-strong p-4">
            <div className="flex items-center gap-2.5">
              <Icon name="receipt_long" className="text-[18px] text-primary" />
              <Meta className="text-ink-muted">Payment verification</Meta>
              <Meta className="ml-auto rounded-[1px] border border-primary bg-primary px-2 py-1 text-white">
                {proof.status || 'Confirmed'}
              </Meta>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
              <Fact label="Transaction reference" value={<span className="font-mono">{proof.transactionId || `TXN-${policy.quoteRequestId}`}</span>} />
              <Fact label="Payment method" value={proof.method || 'Payment gateway'} />
              <Fact label="Amount confirmed" value={<span className="text-primary">{formatZMW(proof.amount || policy.premium || 0)}</span>} />
              <Fact label="Confirmed at" value={proof.confirmedAt ? formatDate(proof.confirmedAt) : 'Just now'} />
            </dl>
          </div>

          <div className="mt-5 border-t border-dashed border-line pt-5">
            <Meta className="text-ink-faint">Customer quote document</Meta>
            {policy.quoteDocument ? (
              <button
                type="button"
                onClick={() => openDocument(policy.quoteDocument)}
                className="mt-3 inline-flex items-center gap-2 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
              >
                <Icon name="open_in_new" className="text-[17px]" />
                View uploaded quote: {policy.quoteDocument.name}
              </button>
            ) : (
              <p className="mt-3 text-[12px] leading-[1.5] text-ink-muted">
                No quote file is attached to this record. The paid quote details are shown above.
              </p>
            )}
          </div>
        </section>

        {/* ── The certificate that activates the policy ──────────── */}
        <form onSubmit={submit} className="ticked border border-primary p-6">
          <Meta className="text-primary">Upload official policy certificate</Meta>
          <p className="mt-3 text-[13px] leading-[1.55] text-ink-muted">
            Prepare the certificate in your insurer system, then upload the final file. The same
            document becomes available to the customer.
          </p>

          <label className="mt-6 block">
            <span className={fieldLabelClass}>Your policy number</span>
            <input
              value={insurerPolicyNumber}
              onChange={(event) => setInsurerPolicyNumber(event.target.value)}
              className={inputClass}
              placeholder="e.g. PA-2026-00412"
            />
          </label>

          <div className="mt-6">
            <span className={fieldLabelClass}>Official policy certificate *</span>
            <DocumentPicker
              document={certificate.document}
              onPick={certificate.pick}
              onClear={certificate.clear}
              error={certificate.error}
              prompt="Upload certificate from your system"
            />
          </div>

          <button
            type="submit"
            className="group relative mt-7 flex min-h-[50px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary px-4 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
            <Icon name="verified" className="relative text-[18px]" />
            <span className="relative">Issue active policy &amp; send certificate</span>
          </button>
        </form>
      </div>
    </motion.div>
  );
}
