import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { timeAgo } from '@/lib/time';
import { statusStyle } from '@/features/insurer-portal/portal';
import { Icon } from './ui';

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
    <div className="flex min-h-[500px] gap-4">
      <div className={`flex flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ${selected ? 'hidden md:flex md:w-80' : 'w-full md:w-80'}`}>
        <div className="border-b border-gray-100 p-4">
          <h3 className="text-[16px] font-bold text-primary">Claim notifications</h3>
          <label className="mt-2 block">
            <span className="sr-only">Find by claim number, name or plate</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find by claim number, name or plate" className="w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-primary" />
          </label>
          <p className="mt-2 text-[12px] text-secondary">{claims.length} total · {awaitingCall} awaiting the customer's call</p>
        </div>
        <div className="flex-1 divide-y divide-gray-50 overflow-y-auto">
          {claims.length === 0 && (
            <div className="py-12 text-center"><Icon name="inbox" className="text-5xl text-gray-200" /><p className="mt-2 text-[13px] text-secondary">No claims yet.</p></div>
          )}
          {claims.length > 0 && visible.length === 0 && <p className="p-6 text-center text-[13px] text-secondary">No notification matches "{query}".</p>}
          {visible.map((claim) => <ClaimListItem key={claim.id} claim={claim} active={claim.id === selectedId} onSelect={() => setSelectedId(claim.id)} />)}
        </div>
      </div>

      <div className={`flex-1 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ${selected ? 'flex flex-col' : 'hidden items-center justify-center md:flex'}`}>
        {selected ? (
          <ClaimDetail key={selected.id} claim={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="p-8 text-center">
            <Icon name="policy" className="text-5xl text-gray-200" />
            <p className="mb-1 mt-3 text-[16px] font-bold text-primary">Select a notification</p>
            <p className="text-[13px] text-secondary">Look up the claim number a customer quotes on the phone and mark it received.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ClaimListItem({ claim, active, onSelect }) {
  const style = statusStyle(claim.status);
  return (
    <button type="button" onClick={onSelect} className={`w-full p-4 text-left transition-all ${active ? 'border-l-4 border-l-primary bg-primary/5' : 'hover:bg-gray-50'}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${style.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-primary">{claim.type}</p>
          <p className="text-[11px] text-secondary">{claim.fullName} · {claim.claimNumber || claim.id}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>{claim.status}</span>
            <span className="text-[10px] text-secondary">{timeAgo(claim.submittedAt)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function ClaimDetail({ claim, onBack }) {
  const markClaimReceived = useStore((state) => state.markClaimReceived);
  const [saving, setSaving] = useState(false);
  const style = statusStyle(claim.status);
  const received = claim.status === 'Received by insurer';

  const handleReceived = () => {
    setSaving(true);
    setTimeout(() => { markClaimReceived(claim.id); setSaving(false); }, 400);
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
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex h-full flex-col">
      <div className="border-b border-gray-100 bg-white p-5">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} aria-label="Back" className="rounded-full p-1.5 hover:bg-gray-100 md:hidden"><Icon name="arrow_back" className="text-[20px]" /></button>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[18px] font-bold text-primary">{claim.claimNumber || claim.id}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${style.badge}`}>{claim.status}</span>
            </div>
            <h2 className="mt-1 text-[16px] font-bold text-on-surface">{claim.type}</h2>
            <p className="text-[12px] text-secondary">Notified {timeAgo(claim.submittedAt)}{received && claim.receivedAt ? ` · received ${timeAgo(claim.receivedAt)}` : ''}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <dl className="grid grid-cols-2 gap-3">
          {facts.map(([label, value]) => (
            <div key={label}><dt className="text-[10px] font-bold uppercase text-secondary">{label}</dt><dd className="text-[13px] font-semibold text-on-surface">{value}</dd></div>
          ))}
        </dl>
        {claim.description && (
          <div className="rounded-xl bg-gray-50 p-3"><p className="mb-1 text-[11px] font-bold uppercase text-secondary">Incident description</p><p className="text-[13px] leading-relaxed text-on-surface">{claim.description}</p></div>
        )}
        {claim.supportingDocs?.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase text-secondary">Documents attached</p>
            <ul className="flex flex-wrap gap-2">
              {claim.supportingDocs.map((doc, index) => <li key={`${doc.name}-${index}`} className="rounded-md bg-slate-100 px-2 py-1 text-[12px] font-semibold text-secondary">{doc.name || doc.fileName || 'Document'}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 p-4">
        {received ? (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-primary"><Icon name="task_alt" className="text-[18px]" />Received — this claim continues in your own claims system.</p>
        ) : (
          <>
            <p className="mb-3 text-[12px] text-secondary">When the customer calls and quotes this claim number, mark it received. Assessment and settlement continue in your own claims system.</p>
            <button type="button" onClick={handleReceived} disabled={saving} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-bold text-white hover:bg-primary-container disabled:opacity-50">
              <Icon name={saving ? 'sync' : 'call_received'} className={`text-[18px] ${saving ? 'animate-spin' : ''}`} />{saving ? 'Saving…' : 'Mark as received'}
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}
