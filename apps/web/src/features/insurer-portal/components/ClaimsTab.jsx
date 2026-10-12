import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/api';
import { hydrateInsurerPortal } from '@/api/sync';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { timeAgo } from '@/lib/time';
import { statusStyle } from '@/features/insurer-portal/portal';
import Meta from '@/components/ui/Meta';
import { Fact, Icon } from './ui';
import { fieldClass as inputClass } from '@/components/ui/field';

const matchesQuery = (claim, query) =>
  [claim.claimNumber, claim.id, claim.fullName, claim.plate, claim.phone].some((value) => String(value || '').toLowerCase().includes(query));

/**
 * First-notification inbox. The insurer looks up the claim number a customer
 * quotes on the phone and marks it received; assessment and settlement then
 * continue in the insurer's own claims system.
 */
export default function ClaimsTab({ claims }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const trimmed = query.trim().toLowerCase();
  const visible = trimmed ? claims.filter((claim) => matchesQuery(claim, trimmed)) : claims;
  const selected = claims.find((claim) => claim.id === selectedId) || null;
  const awaitingCall = claims.filter((claim) => claim.status === 'Notified').length;

  return (
    <div className="flex min-h-[520px] border border-line">
      {/* ── Inbox ─────────────────────────────────────────────── */}
      <div className={`flex shrink-0 flex-col ${selected ? 'hidden md:flex md:w-[320px] md:border-r md:border-line' : 'w-full md:w-[320px] md:border-r md:border-line'}`}>
        <div className="border-b border-dashed border-line p-5">
          <Meta className="text-primary">Claim notifications</Meta>
          <label className="mt-4 block">
            <span className="sr-only">Find by claim number, name or plate</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Claim number, name or plate"
              className={`${inputClass} py-2.5 text-[14px]`}
            />
          </label>
          <Meta className="mt-4 block text-ink-faint">
            {claims.length} total · {awaitingCall} awaiting call
          </Meta>
        </div>

        <div className="flex-1 overflow-y-auto">
          {claims.length === 0 && (
            <div className="py-14 text-center">
              <Icon name="inbox" className="text-[30px] text-line-strong" />
              <p className="mt-3 text-[13px] text-ink-muted">No claims yet.</p>
            </div>
          )}
          {claims.length > 0 && visible.length === 0 && (
            <p className="p-6 text-center text-[13px] text-ink-muted">No notification matches “{query}”.</p>
          )}
          {visible.map((claim, index) => (
            <ClaimListItem
              key={claim.id}
              claim={claim}
              isFirst={index === 0}
              active={claim.id === selectedId}
              onSelect={() => setSelectedId(claim.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Detail ────────────────────────────────────────────── */}
      <div className={`flex-1 ${selected ? 'flex flex-col' : 'hidden items-center justify-center md:flex'}`}>
        {selected ? (
          <ClaimDetail key={selected.id} claim={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="p-10 text-center">
            <Icon name="policy" className="text-[32px] text-line-strong" />
            <p className="mt-4 text-[16px] font-medium tracking-[-0.01em] text-ink">Select a notification</p>
            <p className="mx-auto mt-2 max-w-sm text-[13px] leading-[1.55] text-ink-muted">
              Look up the claim number a customer quotes on the phone and mark it received.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ClaimListItem({ claim, active, isFirst, onSelect }) {
  const style = statusStyle(claim.status);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-l-2 p-4 text-left transition-colors duration-200 ease-out ${isFirst ? '' : 'border-t border-t-dashed border-t-line'} ${
        active ? 'border-l-primary bg-primary/[0.03]' : 'border-l-transparent hover:bg-canvas-2'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium tracking-[-0.01em] text-ink">{claim.type}</p>
          <Meta className="mt-1.5 block truncate text-ink-faint">{claim.claimNumber || claim.id}</Meta>
          <p className="mt-1 truncate text-[12px] text-ink-muted">{claim.fullName}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <Meta className={`rounded-[1px] border px-2 py-1 ${style.badge}`}>{claim.status}</Meta>
            <Meta className="text-ink-faint">{timeAgo(claim.submittedAt)}</Meta>
          </div>
        </div>
      </div>
    </button>
  );
}

function ClaimDetail({ claim, onBack }) {

  const [saving, setSaving] = useState(false);
  const style = statusStyle(claim.status);
  const received = claim.status === 'Received by insurer';

  const handleReceived = () => {
    setSaving(true);
    void (async () => {
      try {
        await api.claims.markReceived(claim.claimNumber || claim.id);
        await hydrateInsurerPortal();
      } finally {
        setSaving(false);
      }
    })();
  };

  const facts = [
    ['Claim number', claim.claimNumber || claim.id],
    ['Customer', `${claim.fullName || 'Customer'} · ${claim.phone || '—'}`],
    ['Email', claim.email || 'Not provided'],
    ['Vehicle', `${claim.vehicle || '—'}${claim.plate ? ` · ${claim.plate}` : ''}`],
    ['Policy / cover', claim.policyNumber || claim.coverageType || 'Not provided'],
    ['Incident date', formatDate(claim.incidentDate)],
    ['Location', claim.location || '—'],
    ['Estimated loss', claim.estimatedLoss ? formatZMW(parseFloat(claim.estimatedLoss)) : 'Not stated'],
    ['Police report', claim.policeReport ? `Yes — ${claim.policeReportNumber || 'filed'}` : 'No'],
    ...(claim.lateReason ? [['Late notification reason', claim.lateReason]] : []),
  ];

  return (
    <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="flex h-full flex-col">
      <div className="border-b border-dashed border-line p-5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="rounded-[1px] border border-line-strong p-1.5 transition-colors duration-200 ease-out hover:border-primary md:hidden"
          >
            <Icon name="arrow_back" className="text-[18px] text-ink-muted" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[18px] tracking-[0.02em] text-primary">{claim.claimNumber || claim.id}</span>
              <Meta className={`rounded-[1px] border px-2 py-1 ${style.badge}`}>{claim.status}</Meta>
            </div>
            <h2 className="mt-2.5 text-[17px] font-medium tracking-[-0.015em] text-ink">{claim.type}</h2>
            <Meta className="mt-2 block text-ink-faint">
              Notified {timeAgo(claim.submittedAt)}
              {received && claim.receivedAt ? ` · received ${timeAgo(claim.receivedAt)}` : ''}
            </Meta>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
          {facts.map(([label, value]) => <Fact key={label} label={label} value={value} />)}
        </dl>

        {claim.description && (
          <div className="border border-dashed border-line p-4">
            <Meta className="text-ink-faint">Incident description</Meta>
            <p className="mt-3 text-[13px] leading-[1.6] text-ink">{claim.description}</p>
          </div>
        )}

        {claim.supportingDocs?.length > 0 && (
          <div>
            <Meta className="text-ink-faint">Documents attached</Meta>
            <ul className="mt-3 flex flex-wrap gap-2">
              {claim.supportingDocs.map((doc, index) => (
                <li key={`${doc.name}-${index}`} className="rounded-[1px] border border-line-strong px-2.5 py-1.5 text-[12px] text-ink-muted">
                  {doc.name || doc.fileName || 'Document'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-line bg-canvas-2 p-5">
        {received ? (
          <p className="flex items-center gap-2.5 text-[13px] text-ink-muted">
            <Icon name="task_alt" className="text-[18px] text-primary" />
            Received — this claim continues in your own claims system.
          </p>
        ) : (
          <>
            <p className="mb-4 text-[13px] leading-[1.55] text-ink-muted">
              When the customer calls and quotes this claim number, mark it received. Assessment and
              settlement continue in your own claims system.
            </p>
            <button
              type="button"
              onClick={handleReceived}
              disabled={saving}
              className="group relative flex min-h-[46px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary text-[14px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint disabled:hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
              <Icon name={saving ? 'sync' : 'call_received'} className={`relative text-[18px] ${saving ? 'animate-spin' : ''}`} />
              <span className="relative">{saving ? 'Saving…' : 'Mark as received'}</span>
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}
