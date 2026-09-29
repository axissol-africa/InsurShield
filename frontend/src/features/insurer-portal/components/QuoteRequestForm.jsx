import { useState } from 'react';
import { motion } from 'framer-motion';
import { calculatePremium, formatZMW } from '@/domain/premiumEngine';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import Meta from '@/components/ui/Meta';
import { BackButton, DocumentPicker, Fact, Icon } from './ui';
import { fieldClass as inputClass, labelClass as fieldLabelClass } from '@/components/ui/field';
import { benefitsForCoverage } from '@/features/insurer-portal/portal';

const SEND_DELAY_MS = 800;

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

/**
 * The insurer prepares its quotation in its own system, then records it here:
 * the document the customer will see, the premium on it, and how long it stays open.
 */
export default function QuoteRequestForm({ request, insurer, coverDocuments = {}, piaRatePercentage, defaultValidityDays, onSubmit, onBack }) {
  const quotation = useDocumentUpload();
  const [premium, setPremium] = useState('');
  const [reference, setReference] = useState('');
  const [validityDays, setValidityDays] = useState('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);

  const estimate = indicativePremium(request, insurer, piaRatePercentage);
  const coverageType = request.insuranceType || (request.coverage === 'Third Party Only' ? 'ThirdParty' : 'Comprehensive');
  const coverDocument = coverDocuments[coverageType];

  const facts = [
    ['Vehicle', request.plate ? `${request.vehicle} · ${request.plate}` : request.vehicle],
    ['Declared value', request.value],
    ['Declared usage', request.usage],
    ['Requested coverage', request.coverage],
    ['Cover period', `${request.period} · ${request.dates}`],
    ['Customer', request.contact ? `${request.client} · ${request.contact}` : request.client],
    ['Inspection photos', request.photos ? `${request.photos} live photos attached` : 'Not captured'],
  ];

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!quotation.document) {
      quotation.setError('Attach the final quotation from your system before sending it.');
      return;
    }
    if (!coverDocument) {
      quotation.setError(`Add your ${coverageType === 'ThirdParty' ? 'third party only' : 'comprehensive'} cover guide in the Cover guides tab before sending this quote.`);
      return;
    }
    const amount = Number(premium);
    if (!(amount > 0)) {
      quotation.setError('Enter the premium exactly as it appears on your quotation.');
      return;
    }
    setSending(true);
    setTimeout(() => onSubmit({
      premium: amount,
      notes: notes.trim(),
      validityDays: Number(validityDays) || defaultValidityDays,
      insurerReference: reference.trim() || null,
      document: quotation.document,
      coverGuide: {
        coverageType,
        document: coverDocument,
        benefits: benefitsForCoverage(insurer, coverageType),
        inspectionRules: insurer?.inspectionRules || 'May be requested',
        claimsContact: insurer?.contact?.phone || insurer?.contact?.email || null,
      },
    }), SEND_DELAY_MS);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full pb-8">
      <div className="mb-8 flex items-center gap-4 border-b border-line pb-7">
        <BackButton onClick={onBack} />
        <div>
          <Meta className="text-ink-muted">Process quotation</Meta>
          <h2 className="mt-3 font-mono text-[24px] tracking-[0.02em] text-primary">{request.id}</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <section className="border border-line p-6">
          <div className="border-b border-dashed border-line pb-4">
            <Meta className="text-primary">Client &amp; vehicle</Meta>
          </div>
          <dl className="mt-6 space-y-5">
            {facts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
          </dl>
        </section>

        <section className="ticked border border-primary p-6">
          <div className="border-b border-dashed border-line pb-4">
            <Meta className="text-primary">Upload your quotation</Meta>
          </div>
          <p className="mb-7 mt-5 text-[13px] leading-[1.6] text-ink-muted">
            Prepare and upload the final quotation from your own system. The customer sees the same
            document on their comparison page and is charged the premium shown on it. The matching cover guide is attached automatically.
          </p>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className={`border p-4 ${coverDocument ? 'border-primary/30 bg-primary/[0.03]' : 'border-primary/40 bg-primary/[0.06]'}`}>
              <div className="flex items-start gap-3">
                <Icon name={coverDocument ? 'task_alt' : 'description'} className="text-[21px] text-primary" />
                <div>
                  <span className="block text-[13px] font-medium text-ink">{coverageType === 'ThirdParty' ? 'Third party only' : 'Comprehensive'} cover guide</span>
                  <span className="mt-1 block text-[12px] leading-[1.5] text-ink-muted">{coverDocument ? `${coverDocument.name} will be sent with this quote.` : 'Required before this quote can be sent. Go back and add it under Cover guides.'}</span>
                </div>
              </div>
            </div>
            <div>
              <span className={fieldLabelClass}>Quotation document (PDF or image)</span>
              <DocumentPicker document={quotation.document} onPick={quotation.pick} onClear={quotation.clear} error={quotation.error} prompt="Attach quotation from your system" />
            </div>
            <label className="block">
              <span className={fieldLabelClass}>Your internal quote reference</span>
              <input value={reference} onChange={(event) => setReference(event.target.value)} className={inputClass} placeholder="e.g. PA-Q-2026-00412" />
              <span className="mt-2 block text-[12px] leading-[1.5] text-ink-muted">Shown to the customer so they can quote it when they call you.</span>
            </label>
            <div>
              <label className="block">
                <span className={fieldLabelClass}>Premium on your quotation (ZMW) *</span>
                <div className="flex gap-2">
                  <input required type="number" min="1" step="0.01" value={premium} onChange={(event) => setPremium(event.target.value)} className={inputClass} placeholder="e.g. 21000" />
                  {estimate > 0 && <button type="button" onClick={() => setPremium(estimate.toFixed(2))} className="shrink-0 rounded-[1px] border border-dashed border-line-strong px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary">Use estimate</button>}
                </div>
              </label>
              <p className="mt-2 text-[12px] leading-[1.5] text-ink-muted">
                Must match the figure on the uploaded quotation — the customer pays this amount.
                {estimate > 0 && <> InsurShield's indicative estimate is {formatZMW(estimate)}.</>} With a direct system integration this is read from your quote automatically.
              </p>
            </div>
            <label className="block">
              <span className={fieldLabelClass}>Quote valid for (days)</span>
              <input type="number" min="1" max="30" value={validityDays} onChange={(event) => setValidityDays(event.target.value)} className={inputClass} placeholder={`Default ${defaultValidityDays} days`} />
              <span className="mt-2 block text-[12px] leading-[1.5] text-ink-muted">After this the customer cannot pay on this quote and must request new quotes. You can extend an open quote from the list.</span>
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Special conditions / notes</span>
              <textarea rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} className={inputClass} placeholder="e.g. Requires tracking device installation…" />
            </label>
            <button
              type="submit"
              disabled={sending}
              className="group relative flex min-h-[52px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint disabled:hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
              <Icon name={sending ? 'sync' : 'send'} className={`relative text-[18px] ${sending ? 'animate-spin' : ''}`} />
              <span className="relative">{sending ? 'Sending…' : 'Send quote to customer'}</span>
            </button>
          </form>
        </section>
      </div>
    </motion.div>
  );
}
