import { useEffect, useState } from 'react';
import { formatDate } from '@/domain/premiumEngine';

const GRID = 'lg:grid-cols-[1.55fr_1fr_.65fr_.85fr_.75fr_2.25fr]';
const STATUS_BADGE = {
  Active: 'bg-primary/10 text-primary',
  Inactive: 'bg-gray-100 text-gray-600',
  Deleted: 'bg-gray-100 text-gray-500 line-through',
};

/**
 * Manage Insurers list: inline rate editing, view/edit, and a per-row menu to
 * deactivate (no new requests, history kept), reactivate, or delete (soft).
 */
export default function InsurerTable({ insurers, piaRatePercentage, onView, onEdit, onRateChange, onStatusChange, onDelete }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className={`hidden border-b border-gray-100 bg-gray-50 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-secondary lg:grid ${GRID}`}>
        <div>Company</div><div>Licence</div><div>Rate %</div><div>Effective rate</div><div>Status</div><div className="text-right">Actions</div>
      </div>
      <div className="divide-y divide-gray-50">
        {insurers.map((insurer) => (
          <InsurerRow key={insurer.id} insurer={insurer} piaRatePercentage={piaRatePercentage} onView={() => onView(insurer)} onEdit={() => onEdit(insurer)}
            onRateChange={(rate) => onRateChange(insurer.id, rate)} onStatusChange={(status) => onStatusChange(insurer.id, status)} onDelete={() => onDelete(insurer)} />
        ))}
      </div>
    </div>
  );
}

function InsurerRow({ insurer, piaRatePercentage, onView, onEdit, onRateChange, onStatusChange, onDelete }) {
  const status = insurer.status || 'Active';
  const effectiveRate = Math.max(insurer.ratePercentage, piaRatePercentage);
  return (
    <div className={`grid grid-cols-1 items-center gap-2 px-5 py-4 transition-colors hover:bg-gray-50 lg:gap-0 ${GRID}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-100 bg-white">
          {insurer.logoUrl ? <img src={insurer.logoUrl} alt="" className="max-h-7 max-w-7 object-contain" /> : <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">{insurer.icon || 'business'}</span>}
        </span>
        <div>
          <div className="text-[14px] font-semibold text-primary">{insurer.name}</div>
          <div className="text-[11px] text-secondary">{insurer.coverage || '—'} · quotes valid {insurer.quoteValidityDays || 5} days</div>
        </div>
      </div>
      <div className="text-[13px] text-secondary">
        <CellLabel>Licence</CellLabel>
        {insurer.licenceNumber ? <>{insurer.licenceNumber}<span className="block text-[11px]">expires {formatDate(insurer.licenceExpiry)}</span></> : <span className="text-amber-700">Licence not recorded</span>}
      </div>
      <div><CellLabel>Rate</CellLabel><RateCell insurer={insurer} onSave={onRateChange} /></div>
      <div className="text-[13px] text-on-surface">
        <CellLabel>Effective rate</CellLabel>
        {effectiveRate}%{insurer.ratePercentage < piaRatePercentage && <span className="ml-1 text-[11px] font-bold text-amber-700">PIA floor</span>}
      </div>
      <div><span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-bold uppercase ${STATUS_BADGE[status] || STATUS_BADGE.Inactive}`}>{status}</span></div>
      <div className="flex items-center gap-2 lg:justify-end">
        <div className="inline-flex overflow-hidden rounded-lg border border-outline-variant bg-white shadow-sm">
          <button type="button" onClick={onView} className="inline-flex min-h-9 items-center justify-center border-r border-outline-variant px-3 py-1.5 text-[12px] font-bold text-secondary hover:bg-gray-50">View</button>
          <button type="button" onClick={onEdit} className="inline-flex min-h-9 items-center justify-center px-3 py-1.5 text-[12px] font-bold text-primary hover:bg-primary/5">Edit</button>
        </div>
        {status !== 'Deleted' && <RowActionsMenu insurer={insurer} status={status} onStatusChange={onStatusChange} onDelete={onDelete} />}
      </div>
    </div>
  );
}

/** Column label shown only when the row stacks vertically and the header row is hidden. */
const CellLabel = ({ children }) => <span className="mr-2 text-[10px] font-bold uppercase tracking-wider text-secondary lg:hidden">{children}</span>;

function RateCell({ insurer, onSave }) {
  const [draft, setDraft] = useState(null); // null = not editing

  if (draft === null) {
    return (
      <div className="inline-flex items-center gap-2 align-middle">
        <span className="text-[14px] font-bold text-primary">{insurer.ratePercentage}%</span>
        <button type="button" aria-label={`Edit rate for ${insurer.name}`} onClick={() => setDraft(String(insurer.ratePercentage))} className="text-secondary transition-colors hover:text-primary">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit</span>
        </button>
      </div>
    );
  }

  const save = () => {
    const rate = parseFloat(draft);
    if (rate > 0) onSave(rate);
    setDraft(null);
  };

  return (
    <div className="inline-flex items-center gap-2 align-middle">
      <input type="number" step="0.1" min="0.1" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`New rate for ${insurer.name}`}
        onKeyDown={(event) => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setDraft(null); }}
        className="w-20 rounded-lg border border-outline-variant p-1.5 text-[13px] outline-none focus:ring-1 focus:ring-primary" />
      <button type="button" onClick={save} aria-label="Save rate" className="text-primary"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">check</span></button>
      <button type="button" onClick={() => setDraft(null)} aria-label="Cancel rate edit" className="text-red-500"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span></button>
    </div>
  );
}

const menuItemClass = 'flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold';

function RowActionsMenu({ insurer, status, onStatusChange, onDelete }) {
  const [open, setOpen] = useState(false);

  // Close on a click anywhere outside the menu or on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !event.target.closest('[data-insurer-actions]')) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const choose = (action) => { setOpen(false); action(); };

  return (
    <div className="relative" data-insurer-actions>
      <button type="button" aria-label={`More actions for ${insurer.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-white text-secondary shadow-sm hover:bg-gray-50">
        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">more_horiz</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-40 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {status === 'Inactive' ? (
            <button type="button" role="menuitem" onClick={() => choose(() => onStatusChange('Active'))} className={`${menuItemClass} text-primary hover:bg-primary/5`}><span className="material-symbols-outlined text-[17px]" aria-hidden="true">restart_alt</span>Reactivate</button>
          ) : (
            <button type="button" role="menuitem" onClick={() => choose(() => onStatusChange('Inactive'))} className={`${menuItemClass} text-secondary hover:bg-gray-50`}><span className="material-symbols-outlined text-[17px]" aria-hidden="true">pause_circle</span>Deactivate</button>
          )}
          <button type="button" role="menuitem" onClick={() => choose(onDelete)} className={`${menuItemClass} border-t border-gray-100 text-red-700 hover:bg-red-50`}><span className="material-symbols-outlined text-[17px]" aria-hidden="true">delete</span>Delete</button>
        </div>
      )}
    </div>
  );
}
