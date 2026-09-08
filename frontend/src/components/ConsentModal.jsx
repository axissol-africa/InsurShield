import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';

const NOTICE_VERSION = '2026.09.07';

const DOCUMENTS = {
  privacy: { title: 'Privacy notice', summary: 'How we collect, use, protect and share your personal and vehicle information.', content: 'We collect the identity, contact, vehicle and insurance details needed to create quotations, issue a policy, support claims, prevent fraud and meet legal obligations. We share only the information needed with insurers participating in your quote request, vehicle-verification partners, payment providers and regulators where required. We do not sell your data. You may request access, correction or deletion where permitted by law by contacting privacy@insurshield.zm.' },
  terms: { title: 'Platform terms', summary: 'The rules for using InsurShield to compare and purchase insurance.', content: 'InsurShield helps you compare offers from participating insurers; it is not the insurer that underwrites the policy. Quotes are estimates until the insurer confirms them. You must provide accurate information and keep it up to date. The selected insurer remains responsible for underwriting, policy issue and claim decisions.' },
  declaration: { title: 'Quote request declaration', summary: 'Your confirmation before your information is sent to insurers.', content: 'You confirm that the information and documents supplied are accurate, that you are authorised to request cover for the vehicle, and that InsurShield may share the request with participating insurers solely to obtain and compare quotes. Incorrect or misleading information may affect a quote, policy or claim.' },
};

export default function ConsentModal({ onAccept, onDecline }) {
  const { setConsent, consentRecord } = useStore();
  const [accepted, setAccepted] = useState({ privacy: false, terms: false, declaration: false });
  const [marketing, setMarketing] = useState(false);
  const [expanded, setExpanded] = useState('privacy');
  const [showValidation, setShowValidation] = useState(false);
  const requiredComplete = Object.values(accepted).every(Boolean);
  const hasVersionChange = Boolean(consentRecord?.noticeVersion && consentRecord.noticeVersion !== NOTICE_VERSION);
  const remaining = useMemo(() => Object.values(accepted).filter(value => !value).length, [accepted]);

  const continueFlow = () => {
    if (!requiredComplete) return setShowValidation(true);
    setConsent(true, { noticeVersion: NOTICE_VERSION, acceptedAt: new Date().toISOString(), requiredItems: accepted, marketing });
    onAccept?.();
  };

  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[100] flex items-end bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-5">
    <motion.section initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <header className="bg-primary px-6 py-6 text-white sm:px-8"><p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">Before you continue</p><h1 className="mt-1 text-2xl font-bold">Your privacy choices</h1><p className="mt-2 max-w-xl text-sm leading-6 text-white/85">Review three short notices, then confirm the essentials in one place. Full documents remain available whenever you need them.</p></header>
      <div className="space-y-4 p-5 sm:p-8">
        {hasVersionChange && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="flex gap-2"><span className="material-symbols-outlined text-amber-700">new_releases</span><div><p className="font-bold">Our notices have changed</p><p className="mt-1 leading-5">Please review and accept version {NOTICE_VERSION} before continuing. Your earlier consent remains recorded.</p></div></div></div>}
        <div className="flex items-center justify-between rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant"><span><strong className="text-primary">{3 - remaining} of 3</strong> required items confirmed</span><span className="text-xs">Notice version {NOTICE_VERSION}</span></div>
        <div className="space-y-3">{Object.entries(DOCUMENTS).map(([key, document]) => <article key={key} className={`rounded-2xl border p-4 transition-colors ${accepted[key] ? 'border-green-300 bg-green-50/60' : 'border-gray-200 bg-white'}`}><div className="flex gap-3"><input aria-label={`Accept ${document.title}`} type="checkbox" checked={accepted[key]} onChange={event => setAccepted(current => ({ ...current, [key]: event.target.checked }))} className="mt-1 h-5 w-5 shrink-0 accent-primary" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-bold text-primary">{document.title}</h2><p className="mt-1 text-sm leading-5 text-on-surface-variant">{document.summary}</p></div><button type="button" onClick={() => setExpanded(expanded === key ? null : key)} className="shrink-0 text-sm font-bold text-primary underline underline-offset-4">{expanded === key ? 'Hide details' : 'Read full notice'}</button></div>{expanded === key && <div className="mt-4 rounded-xl bg-white p-4 text-sm leading-6 text-on-surface-variant shadow-sm">{document.content}</div>}</div></div></article>)}</div>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-gray-200 bg-surface-container-low p-4"><input type="checkbox" checked={marketing} onChange={event => setMarketing(event.target.checked)} className="mt-1 h-5 w-5 accent-primary" /><span><span className="block text-sm font-bold text-primary">Keep me informed (optional)</span><span className="mt-1 block text-sm leading-5 text-on-surface-variant">Send product updates and helpful insurance reminders. You can opt out at any time.</span></span></label>
        {showValidation && !requiredComplete && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">Please accept the {remaining} remaining required item{remaining === 1 ? '' : 's'} to continue.</p>}
      </div>
      <footer className="sticky bottom-0 flex gap-3 border-t border-gray-100 bg-white p-5 sm:px-8"><button type="button" onClick={onDecline} className="min-h-12 rounded-xl border border-gray-300 px-5 text-sm font-bold text-on-surface-variant">Not now</button><button type="button" onClick={continueFlow} className="min-h-12 flex-1 rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary-container">Accept required items & continue</button></footer>
    </motion.section>
  </motion.div>;
}
