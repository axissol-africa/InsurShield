import { useEffect, useState } from 'react';
import { formatDate } from '@/domain/premiumEngine';
import Meta from '@/components/ui/Meta';

const GRID = 'lg:grid-cols-[1.55fr_1fr_.65fr_.85fr_.75fr_2.25fr]';
/** Accent marks an insurer that is actually receiving requests. */
const STATUS_BADGE = {
  Active: 'border-primary/30 bg-primary/10 text-primary',
  Inactive: 'border-line-strong text-ink-muted',
  Deleted: 'border-line-strong text-ink-faint line-through',
};

/**
 * Manage Insurers list: inline rate editing, view/edit, and a per-row menu to
 * deactivate (no new requests, history kept), reactivate, or delete (soft).
 */
export default function InsurerTable({ insurers, piaRatePercentage, onView, onEdit, onRateChange, onStatusChange, onDelete, onRestore }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className={`hidden border-b border-border bg-muted/50 px-5 py-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground lg:grid lg:gap-x-5 ${GRID}`}>
        <div>Company</div><div>Licence</div><div>Rate %</div><div>Effective rate</div><div>Status</div><div className="text-right">Actions</div>
      </div>
      <div className="divide-y divide-border">
        {insurers.map((insurer) => (
          <InsurerRow key={insurer.id} insurer={insurer} piaRatePercentage={piaRatePercentage} onView={() => onView(insurer)} onEdit={() => onEdit(insurer)}
            onRateChange={(rate) => onRateChange(insurer.id, rate)} onStatusChange={(status) => onStatusChange(insurer.id, status)}
            onDelete={() => onDelete(insurer)} onRestore={() => onRestore?.(insurer)} />
        ))}
      </div>
    </div>
  );
}

function InsurerRow({ insurer, piaRatePercentage, onView, onEdit, onRateChange, onStatusChange, onDelete, onRestore }) {
  const status = insurer.status || 'Active';
  const effectiveRate = Math.max(insurer.ratePercentage, piaRatePercentage);
  return (
    <div className={`group grid grid-cols-1 items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40 lg:gap-x-5 lg:gap-y-0 ${GRID}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary">
          {insurer.logoUrl ? <img src={insurer.logoUrl} alt="" className="max-h-7 max-w-7 object-contain" /> : <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">{insurer.icon || 'business'}</span>}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{insurer.name}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{insurer.coverage || '—'} · quotes valid {insurer.quoteValidityDays || 5} days</div>
        </div>
      </div>
      <div className="min-w-0 text-sm text-muted-foreground">
        <CellLabel>Licence</CellLabel>
        {insurer.licenceNumber
          ? <><span className="font-mono text-foreground">{insurer.licenceNumber}</span><span className="mt-1 block text-xs">expires {formatDate(insurer.licenceExpiry)}</span></>
          : <span className="text-primary">Licence not recorded</span>}
      </div>
      <div><CellLabel>Rate</CellLabel><RateCell insurer={insurer} onSave={onRateChange} /></div>
      <div className="text-sm">
        <CellLabel>Effective rate</CellLabel>
        <span className="font-medium">{effectiveRate}%</span>
        {insurer.ratePercentage < piaRatePercentage && (
          <Meta className="ml-2 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-1 text-primary">PIA floor</Meta>
        )}
      </div>
      <div><Meta className={`inline-flex rounded-full border px-2.5 py-1 ${STATUS_BADGE[status] || STATUS_BADGE.Inactive}`}>{status}</Meta></div>
      <div className="flex items-center gap-2 lg:justify-end">
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          <button type="button" onClick={onView} className="inline-flex min-h-9 items-center justify-center border-r border-border px-4 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">View</button>
          <button type="button" onClick={onEdit} className="inline-flex min-h-9 items-center justify-center px-4 text-xs font-medium text-primary transition-colors hover:bg-primary/10">Edit</button>
        </div>
        {status === 'Deleted' ? (
          <button
            type="button"
            onClick={onRestore}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">restart_alt</span>
            Restore
          </button>
        ) : (
          <RowActionsMenu insurer={insurer} status={status} onStatusChange={onStatusChange} onDelete={onDelete} />
        )}
      </div>
    </div>
  );
}

/** Column label shown only when the row stacks vertically and the header row is hidden. */
const CellLabel = ({ children }) => <span className="mr-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground lg:hidden">{children}</span>;

function RateCell({ insurer, onSave }) {
  const [draft, setDraft] = useState(null); // null = not editing

  if (draft === null) {
    return (
      <div className="inline-flex items-center gap-2 align-middle">
        <span className="text-sm font-semibold text-primary">{insurer.ratePercentage}%</span>
        <button type="button" aria-label={`Edit rate for ${insurer.name}`} onClick={() => setDraft(String(insurer.ratePercentage))} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">
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
        className="w-20 rounded-lg border border-border bg-background p-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      <button type="button" onClick={save} aria-label="Save rate" className="rounded-md p-1 text-primary hover:bg-primary/10"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">check</span></button>
      <button type="button" onClick={() => setDraft(null)} aria-label="Cancel rate edit" className="rounded-md p-1 text-red-600 hover:bg-red-50"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span></button>
    </div>
  );
}

const menuItemClass = 'flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium transition-colors';

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
        className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-primary">
        <span className="material-symbols-outlined text-[20px]" aria-hidden="true">more_horiz</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
          {status === 'Inactive' ? (
            <button type="button" role="menuitem" onClick={() => choose(() => onStatusChange('Active'))} className={`${menuItemClass} text-primary hover:bg-primary/10`}><span className="material-symbols-outlined text-[17px]" aria-hidden="true">restart_alt</span>Reactivate</button>
          ) : (
            <button type="button" role="menuitem" onClick={() => choose(() => onStatusChange('Inactive'))} className={`${menuItemClass} text-muted-foreground hover:bg-muted`}><span className="material-symbols-outlined text-[17px]" aria-hidden="true">pause_circle</span>Deactivate</button>
          )}
          <button type="button" role="menuitem" onClick={() => choose(onDelete)} className={`${menuItemClass} mt-1 border-t border-border text-primary hover:bg-primary/10`}><span className="material-symbols-outlined text-[17px]" aria-hidden="true">delete</span>Remove</button>
        </div>
      )}
    </div>
  );
}
