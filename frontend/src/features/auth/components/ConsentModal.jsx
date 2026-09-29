import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import Meta from '@/components/ui/Meta';

const NOTICE_VERSION = '2026.09.07';

const DOCUMENTS = {
  privacy: {
    title: 'Privacy notice',
    summary: 'How we collect, use, protect and share your personal and vehicle information.',
    content:
      'We collect the identity, contact, vehicle and insurance details needed to create quotations, issue a policy, support claims, prevent fraud and meet legal obligations. We share only the information needed with insurers participating in your quote request, vehicle-verification partners, payment providers and regulators where required. We do not sell your data. You may request access, correction or deletion where permitted by law by contacting privacy@insurshield.zm.',
  },
  terms: {
    title: 'Platform terms',
    summary: 'The rules for using InsurShield to compare and purchase insurance.',
    content:
      'InsurShield helps you compare offers from participating insurers; it is not the insurer that underwrites the policy. Quotes are estimates until the insurer confirms them. You must provide accurate information and keep it up to date. The selected insurer remains responsible for underwriting, policy issue and claim decisions.',
  },
  declaration: {
    title: 'Quote request declaration',
    summary: 'Your confirmation before your information is sent to insurers.',
    content:
      'You confirm that the information and documents supplied are accurate, that you are authorised to request cover for the vehicle, and that InsurShield may share the request with participating insurers solely to obtain and compare quotes. Incorrect or misleading information may affect a quote, policy or claim.',
  },
};

const KEYS = Object.keys(DOCUMENTS);

/**
 * The privacy and terms acceptance that the customer-entry flow requires
 * before any protected step. Authenticating is not consenting, so this is a
 * deliberate, separate act — and the record it produces is written against the
 * account by the caller, not kept in the browser.
 */
export default function ConsentModal({ onAccept, onDecline }) {
  const { setConsent, consentRecord } = useStore();
  const [accepted, setAccepted] = useState({ privacy: false, terms: false, declaration: false });
  const [marketing, setMarketing] = useState(false);
  const [expanded, setExpanded] = useState('privacy');
  const [showValidation, setShowValidation] = useState(false);
  const firstCheckbox = useRef(null);

  const requiredComplete = Object.values(accepted).every(Boolean);
  const hasVersionChange = Boolean(consentRecord?.noticeVersion && consentRecord.noticeVersion !== NOTICE_VERSION);
  const remaining = useMemo(() => Object.values(accepted).filter((value) => !value).length, [accepted]);
  const confirmed = KEYS.length - remaining;

  // Escape declines, matching every other dismissible surface in the product.
  useEffect(() => {
    firstCheckbox.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onDecline?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDecline]);

  const continueFlow = () => {
    if (!requiredComplete) return setShowValidation(true);
    const record = { noticeVersion: NOTICE_VERSION, acceptedAt: new Date().toISOString(), requiredItems: accepted, marketing };
    setConsent(true, record);
    // The caller persists this against the account.
    return onAccept?.(record);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/50 backdrop-blur-[2px] sm:items-center sm:p-6"
    >
      <motion.section
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col border border-line bg-canvas"
      >
        {/* ── What this is ─────────────────────────────────────── */}
        <header className="relative overflow-hidden bg-ink px-6 py-7 sm:px-8">
          <div className="hatch pointer-events-none absolute inset-0 text-white/[0.06]" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-3">
              <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
              <Meta className="text-white/50">Before you continue</Meta>
            </span>
            <h2 id="consent-title" className="mt-5 text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-white">
              Your privacy choices
            </h2>
            <p className="mt-3 max-w-lg text-[14px] leading-[1.6] text-white/60">
              Three short notices. Accept the required ones to continue; the full text of each stays
              available from your account.
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {hasVersionChange && (
            <div className="flex gap-3 border-b border-dashed border-line bg-primary/[0.03] px-6 py-4 sm:px-8">
              <span className="material-symbols-outlined shrink-0 text-[18px] text-primary" aria-hidden="true">new_releases</span>
              <div>
                <p className="text-[14px] font-medium text-ink">Our notices have changed</p>
                <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-muted">
                  Please review and accept version {NOTICE_VERSION}. Your earlier consent stays recorded.
                </p>
              </div>
            </div>
          )}

          {/* Progress, as a meter rather than a sentence alone. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4 sm:px-8">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex items-center gap-1.5">
                {KEYS.map((key) => (
                  <span
                    key={key}
                    className={`block h-[3px] w-6 ${accepted[key] ? 'bg-primary' : 'bg-line-strong'}`}
                  />
                ))}
              </span>
              <Meta className="text-ink-muted">{confirmed} of {KEYS.length} confirmed</Meta>
            </div>
            <Meta className="text-ink-faint">Version {NOTICE_VERSION}</Meta>
          </div>

          {/* ── The notices ────────────────────────────────────── */}
          {KEYS.map((key, index) => {
            const document = DOCUMENTS[key];
            const isOpen = expanded === key;
            return (
              <article
                key={key}
                className={`px-6 py-5 transition-colors duration-200 ease-out sm:px-8 ${index === 0 ? '' : 'border-t border-dashed border-line'} ${accepted[key] ? 'bg-primary/[0.02]' : ''}`}
              >
                <div className="flex gap-4">
                  <input
                    ref={index === 0 ? firstCheckbox : undefined}
                    id={`consent-${key}`}
                    type="checkbox"
                    checked={accepted[key]}
                    onChange={(event) => setAccepted((current) => ({ ...current, [key]: event.target.checked }))}
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[#dc2626] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dc2626]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <label htmlFor={`consent-${key}`} className="cursor-pointer">
                        <span className={`block text-[15px] font-medium tracking-[-0.01em] ${accepted[key] ? 'text-primary' : 'text-ink'}`}>
                          {document.title}
                        </span>
                        <span className="mt-1.5 block text-[13px] leading-[1.55] text-ink-muted">{document.summary}</span>
                      </label>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`consent-detail-${key}`}
                        onClick={() => setExpanded(isOpen ? null : key)}
                        className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-primary underline-offset-4 hover:underline"
                      >
                        {isOpen ? 'Hide' : 'Read full'}
                      </button>
                    </div>
                    {isOpen && (
                      <p id={`consent-detail-${key}`} className="mt-4 border border-dashed border-line-strong p-4 text-[13px] leading-[1.65] text-ink-muted">
                        {document.content}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {/* ── Optional ───────────────────────────────────────── */}
          <div className="border-t border-line px-6 py-5 sm:px-8">
            <label htmlFor="consent-marketing" className="flex cursor-pointer gap-4 border border-dashed border-line-strong p-4">
              <input
                id="consent-marketing"
                type="checkbox"
                checked={marketing}
                onChange={(event) => setMarketing(event.target.checked)}
                className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[#dc2626] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dc2626]"
              />
              <span>
                <span className="flex items-center gap-2.5">
                  <span className="text-[14px] font-medium text-ink">Keep me informed</span>
                  <Meta className="rounded-[1px] border border-line-strong px-2 py-1 text-ink-faint">Optional</Meta>
                </span>
                <span className="mt-1.5 block text-[13px] leading-[1.55] text-ink-muted">
                  Product updates and renewal reminders. You can opt out at any time.
                </span>
              </span>
            </label>

            {showValidation && !requiredComplete && (
              <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-[1px] border border-primary bg-primary/[0.04] p-3.5 text-[13px] leading-[1.5] text-primary">
                <span className="material-symbols-outlined mt-px shrink-0 text-[16px]" aria-hidden="true">error</span>
                Accept the {remaining} remaining required item{remaining === 1 ? '' : 's'} to continue.
              </p>
            )}
          </div>
        </div>

        {/* ── Decide ───────────────────────────────────────────── */}
        <footer className="flex flex-col-reverse gap-3 border-t border-line bg-canvas p-5 sm:flex-row sm:px-8">
          <button
            type="button"
            onClick={onDecline}
            className="inline-flex min-h-[50px] items-center justify-center rounded-[1px] border border-dashed border-line-strong px-6 text-[14px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={continueFlow}
            className="group relative inline-flex min-h-[50px] flex-1 items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary px-6 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
            <span className="relative">Accept and continue</span>
            <span className="material-symbols-outlined relative text-[18px] transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
          </button>
        </footer>
      </motion.section>
    </motion.div>
  );
}
