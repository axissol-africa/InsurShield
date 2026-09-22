import { useState } from 'react';
import { motion } from 'framer-motion';
import { calculatePremium, formatZMW } from '@/domain/premiumEngine';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import { BackButton, DocumentPicker, Fact, Icon, fieldLabelClass, inputClass } from './ui';

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
export default function QuoteRequestForm({ request, insurer, piaRatePercentage, defaultValidityDays, onSubmit, onBack }) {
  const quotation = useDocumentUpload();
  const [premium, setPremium] = useState('');
  const [reference, setReference] = useState('');
  const [validityDays, setValidityDays] = useState('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);

  const estimate = indicativePremium(request, insurer, piaRatePercentage);

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
    }), SEND_DELAY_MS);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full pb-8">
      <div className="mb-6 flex items-center gap-4">
        <BackButton onClick={onBack} />
        <h2 className="text-[22px] font-bold text-primary">Process Quotation: {request.id}</h2>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h3 className="mb-4 border-b pb-2 text-[16px] font-bold text-primary">Client & Vehicle Information</h3>
          <dl className="space-y-4">{facts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}</dl>
        </section>

        <section className="rounded-2xl border border-primary/20 bg-white p-6 shadow-sm">
          <h3 className="mb-4 border-b pb-2 text-[16px] font-bold text-primary">Upload your quotation</h3>
          <p className="mb-5 text-[13px] text-secondary">Prepare and upload the final quotation from your own system. The customer sees the same document on their comparison page and is charged the premium shown on it.</p>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <span className={fieldLabelClass}>Quotation document (PDF or image)</span>
              <DocumentPicker document={quotation.document} onPick={quotation.pick} onClear={quotation.clear} error={quotation.error} prompt="Attach quotation from your system" />
            </div>
            <label className="block">
              <span className={fieldLabelClass}>Your internal quote reference</span>
              <input value={reference} onChange={(event) => setReference(event.target.value)} className={inputClass} placeholder="e.g. PA-Q-2026-00412" />
              <span className="mt-1 block text-[11px] text-secondary">Shown to the customer so they can quote it when they call you.</span>
            </label>
            <div>
              <label className="block">
                <span className={fieldLabelClass}>Premium on your quotation (ZMW) *</span>
                <div className="flex gap-2">
                  <input required type="number" min="1" step="0.01" value={premium} onChange={(event) => setPremium(event.target.value)} className={inputClass} placeholder="e.g. 21000" />
                  {estimate > 0 && <button type="button" onClick={() => setPremium(estimate.toFixed(2))} className="shrink-0 rounded-lg border border-primary/30 px-3 text-[12px] font-bold text-primary hover:bg-primary/5">Use estimate</button>}
                </div>
              </label>
              <p className="mt-1 text-[11px] text-secondary">
                Must match the figure on the uploaded quotation — the customer pays this amount.
                {estimate > 0 && <> InsurShield's indicative estimate is {formatZMW(estimate)}.</>} With a direct system integration this is read from your quote automatically.
              </p>
            </div>
            <label className="block">
              <span className={fieldLabelClass}>Quote valid for (days)</span>
              <input type="number" min="1" max="30" value={validityDays} onChange={(event) => setValidityDays(event.target.value)} className={inputClass} placeholder={`Default ${defaultValidityDays} days`} />
              <span className="mt-1 block text-[11px] text-secondary">After this the customer cannot pay on this quote and must request new quotes. You can extend an open quote from the list.</span>
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Special conditions / notes</span>
              <textarea rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} className={inputClass} placeholder="e.g. Requires tracking device installation…" />
            </label>
            <button type="submit" disabled={sending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-[16px] font-semibold text-white shadow-lg transition-all hover:bg-primary-container active:scale-[0.98] disabled:opacity-60">
              <Icon name={sending ? 'sync' : 'send'} className={sending ? 'animate-spin' : ''} />{sending ? 'Sending…' : 'Send quote to customer'}
            </button>
          </form>
        </section>
      </div>
    </motion.div>
  );
}
