/** Small presentational pieces shared by the insurer portal tabs. */
import { formatBytes } from '../../utils/files';

export const inputClass = 'w-full rounded-lg border border-outline-variant bg-surface-container-low p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary';
export const fieldLabelClass = 'mb-2 block text-[12px] font-bold uppercase tracking-wider text-secondary';
export const outlineButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary px-3 text-[12px] font-bold text-primary hover:bg-primary/5';
export const primaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-[12px] font-bold text-white hover:bg-primary-container';

export function Icon({ name, className = '' }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>;
}

export function BackButton({ onClick, label = 'Back' }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm transition-colors hover:bg-gray-50">
      <Icon name="arrow_back" className="text-[20px] text-secondary" />
    </button>
  );
}

export function Fact({ label, value, wide = false }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-secondary">{label}</dt>
      <dd className="mt-1 text-[14px] font-semibold text-on-surface">{value}</dd>
    </div>
  );
}

export function EmptyState({ icon, title, hint }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
      <Icon name={icon} className="text-5xl text-primary/30" />
      <p className="mt-3 text-[16px] font-bold text-on-surface">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-[13px] text-secondary">{hint}</p>}
    </div>
  );
}

/** Pager for a list sliced with `pageSlice`. Renders nothing for a single page. */
export function Pagination({ page, total, pageSize, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  const pagerButton = 'rounded-lg border border-outline-variant px-3 py-1.5 text-[12px] font-bold text-primary disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
      <p className="text-[12px] text-secondary">Page {page} of {pages}</p>
      <div className="flex gap-2">
        <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)} className={pagerButton}>Previous</button>
        <button type="button" disabled={page === pages} onClick={() => onChange(page + 1)} className={pagerButton}>Next</button>
      </div>
    </nav>
  );
}

/** File picker + preview for a PDF/JPG/PNG document record produced by `documentToRecord`. */
export function DocumentPicker({ document, onPick, onClear, prompt, error }) {
  return (
    <>
      {document ? (
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <Icon name={document.type === 'application/pdf' ? 'picture_as_pdf' : 'image'} className="text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{document.name}</span>
            <span className="text-[11px] text-secondary">{formatBytes(document.size)}</span>
          </span>
          <button type="button" onClick={onClear} className="text-[12px] font-bold text-primary hover:underline">Remove</button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-outline-variant bg-surface-container-low p-4 hover:border-primary/50">
          <Icon name="upload_file" className="text-primary" />
          <span className="text-[13px]"><span className="block font-semibold text-on-surface">{prompt}</span><span className="text-secondary">PDF, JPG or PNG up to 3 MB</span></span>
          <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={onPick} />
        </label>
      )}
      {error && <p role="alert" className="mt-1 text-[12px] font-medium text-red-700">{error}</p>}
    </>
  );
}
