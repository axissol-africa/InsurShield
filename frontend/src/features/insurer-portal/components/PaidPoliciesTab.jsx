import { useState } from 'react';
import { motion } from 'framer-motion';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { openDocument } from '@/lib/files';
import { downloadPolicyCertificate } from '@/lib/policyDocuments';
import { timeAgo } from '@/lib/time';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import { BackButton, DocumentPicker, EmptyState, Fact, Icon, fieldLabelClass, inputClass, outlineButtonClass, primaryButtonClass } from './ui';

const coverPeriod = (policy) => `${policy.policyDates?.formattedStart || '—'} – ${policy.policyDates?.formattedEnd || '—'}`;

/**
 * Paid quotes waiting for the insurer's official certificate, plus the
 * policies already issued. Each item links back to the customer's quote request.
 */
export default function PaidPoliciesTab({ policies, onIssue }) {
  return (
    <section>
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-[20px] font-bold text-primary">Paid policy delivery</h3>
          <p className="mt-1 text-[13px] text-secondary">Each item is linked to the exact quote request your team sent to the customer.</p>
        </div>
        <span className="text-[13px] font-semibold text-secondary">{policies.length} paid {policies.length === 1 ? 'policy' : 'policies'} received</span>
      </div>
      {policies.length === 0 ? (
        <EmptyState icon="verified_user" title="No paid policies received yet" hint="When a customer pays for your accepted quote, the paid request appears here for your team to issue the official certificate." />
      ) : (
        <div className="space-y-4">{policies.map((policy) => <PaidPolicyCard key={policy.policyNumber} policy={policy} onIssue={() => onIssue(policy)} />)}</div>
      )}
    </section>
  );
}

function PaidPolicyCard({ policy, onIssue }) {
  const issued = policy.status === 'Active';
  return (
    <article className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 bg-primary/5 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-secondary">{issued ? 'Official policy issued' : 'Paid quote received'}</p>
          <h3 className="mt-1 font-mono text-[20px] font-extrabold text-primary">{policy.policyNumber}</h3>
          <p className="mt-1 text-[13px] text-secondary">Paid quote request: <span className="font-mono font-bold text-on-surface">{policy.quoteRequestId || 'Legacy policy — quote reference unavailable'}</span></p>
        </div>
        <span className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase ${issued ? 'bg-primary text-white' : 'bg-slate-200 text-slate-700'}`}>
          <Icon name={issued ? 'task_alt' : 'pending_actions'} className="text-[15px]" />{issued ? 'Paid · Active' : 'Paid · Awaiting issue'}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-[10px] font-bold uppercase text-secondary">Customer</dt><dd className="mt-1 text-[14px] font-semibold text-on-surface">{policy.customerName || 'Customer'}</dd><dd className="text-[12px] text-secondary">{policy.customerPhone || policy.customerEmail || 'Contact not supplied'}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-secondary">Vehicle</dt><dd className="mt-1 text-[14px] font-semibold text-on-surface">{policy.vehicle || 'Vehicle'}</dd><dd className="text-[12px] text-secondary">{policy.vehicleDetails?.plateNumber || 'Plate not supplied'}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-secondary">Cover period</dt><dd className="mt-1 text-[14px] font-semibold text-on-surface">{coverPeriod(policy)}</dd><dd className="text-[12px] text-secondary">{policy.coverage || policy.plan || 'Policy cover'}</dd></div>
        <div><dt className="text-[10px] font-bold uppercase text-secondary">Premium paid</dt><dd className="mt-1 text-[18px] font-extrabold text-primary">{formatZMW(policy.premium || 0)}</dd><dd className="text-[12px] text-secondary">Received {timeAgo(policy.receivedAt || policy.issuedAt) || 'just now'}</dd></div>
      </dl>

      <div className="mx-5 mb-5 flex flex-col gap-3 rounded-xl border border-primary/20 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Icon name="description" className="text-primary" />
          <div>
            <p className="text-[13px] font-bold text-on-surface">{issued ? 'Official policy certificate' : 'Official certificate required'}</p>
            <p className="text-[11px] text-secondary">{issued ? 'Available to the customer in My account.' : 'Review the paid quote, then upload the certificate from your insurer system.'}</p>
          </div>
        </div>
        {!issued && <button type="button" onClick={onIssue} className={primaryButtonClass}><Icon name="edit_document" className="text-[16px]" />Review & issue policy</button>}
        {issued && policy.certificateDocument && <button type="button" onClick={() => openDocument(policy.certificateDocument)} className={outlineButtonClass}><Icon name="open_in_new" className="text-[16px]" />View certificate</button>}
        {issued && !policy.certificateDocument && <button type="button" onClick={() => downloadPolicyCertificate(policy)} className={outlineButtonClass}><Icon name="download" className="text-[16px]" />Download certificate</button>}
      </div>
      {policy.insurerQuoteReference && <p className="mx-5 mb-5 rounded-lg bg-primary/5 px-3 py-2 text-[12px] text-secondary">Your quote reference: <span className="font-mono font-bold text-on-surface">{policy.insurerQuoteReference}</span></p>}
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full pb-8">
      <div className="mb-6 flex items-center gap-4">
        <BackButton onClick={onBack} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-secondary">Paid policy received</p>
          <h2 className="text-[22px] font-bold text-primary">Issue policy for {policy.quoteRequestId}</h2>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="border-b border-gray-100 pb-4">
            <h3 className="text-[17px] font-bold text-primary">Paid quote in full</h3>
            <p className="mt-1 font-mono text-[12px] text-secondary">{policy.quoteRequestId} · {policy.insurerQuoteReference || 'No insurer quote reference'}</p>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4">
            <Fact label="Customer" value={<>{policy.customerName}<span className="block text-[12px] font-normal text-secondary">{policy.customerPhone}<br />{policy.customerEmail}</span></>} />
            <Fact label="Vehicle" value={<>{policy.vehicle}<span className="block text-[12px] font-normal text-secondary">{policy.vehicleDetails?.plateNumber || '—'}</span></>} />
            <Fact label="Cover" value={<>{policy.plan || policy.coverage}<span className="block text-[12px] font-normal text-secondary">{policy.coverage}</span></>} />
            <Fact label="Premium paid" value={<span className="text-[18px] font-extrabold text-primary">{formatZMW(policy.premium || 0)}</span>} />
            <Fact label="Cover period" value={coverPeriod(policy)} wide />
          </dl>

          <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2">
              <Icon name="receipt_long" className="text-primary" />
              <p className="text-[12px] font-bold text-on-surface">Payment verification</p>
              <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-white">{proof.status || 'Confirmed'}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
              <div><dt className="font-bold uppercase text-secondary">Transaction reference</dt><dd className="mt-1 font-mono font-bold text-on-surface">{proof.transactionId || `TXN-${policy.quoteRequestId}`}</dd></div>
              <div><dt className="font-bold uppercase text-secondary">Payment method</dt><dd className="mt-1 font-semibold text-on-surface">{proof.method || 'Payment gateway'}</dd></div>
              <div><dt className="font-bold uppercase text-secondary">Amount confirmed</dt><dd className="mt-1 font-bold text-primary">{formatZMW(proof.amount || policy.premium || 0)}</dd></div>
              <div><dt className="font-bold uppercase text-secondary">Confirmed at</dt><dd className="mt-1 font-semibold text-on-surface">{proof.confirmedAt ? formatDate(proof.confirmedAt) : 'Just now'}</dd></div>
            </dl>
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <p className="text-[12px] font-bold text-on-surface">Customer quote document</p>
            {policy.quoteDocument ? (
              <button type="button" onClick={() => openDocument(policy.quoteDocument)} className="mt-2 inline-flex items-center gap-2 text-[13px] font-bold text-primary hover:underline"><Icon name="open_in_new" className="text-[17px]" />View uploaded quote: {policy.quoteDocument.name}</button>
            ) : (
              <p className="mt-1 text-[12px] text-secondary">No quote file is attached to this record. The paid quote details are shown above.</p>
            )}
          </div>
        </section>

        <form onSubmit={submit} className="rounded-2xl border border-primary/20 bg-white p-6 shadow-sm">
          <h3 className="text-[17px] font-bold text-primary">Upload official policy certificate</h3>
          <p className="mt-1 text-[13px] text-secondary">Prepare the certificate in your insurer system, then upload the final file. The same document becomes available to the customer.</p>
          <label className="mt-5 block">
            <span className={fieldLabelClass}>Your policy number</span>
            <input value={insurerPolicyNumber} onChange={(event) => setInsurerPolicyNumber(event.target.value)} className={inputClass} placeholder="e.g. PA-2026-00412" />
          </label>
          <div className="mt-5">
            <span className={fieldLabelClass}>Official policy certificate *</span>
            <DocumentPicker document={certificate.document} onPick={certificate.pick} onClear={certificate.clear} error={certificate.error} prompt="Upload certificate from your system" />
          </div>
          <button type="submit" className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-bold text-white hover:bg-primary-container">
            <Icon name="verified" className="text-[18px]" />Issue active policy & send certificate
          </button>
        </form>
      </div>
    </motion.div>
  );
}
