/** Small presentational pieces shared by the insurer portal tabs. */
import { formatBytes } from '@/lib/files';
import Meta from '@/components/ui/Meta';
import SharedEmptyState from '@/components/ui/EmptyState';

export const outlineButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[1px] border border-dashed border-line-strong px-4 text-[13px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary';
export const primaryButtonClass =
  'group relative inline-flex min-h-10 items-center justify-center gap-2 overflow-hidden rounded-[1px] bg-primary px-4 text-[13px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]';

export function Icon({ name, className = '' }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>;
}

export function BackButton({ onClick, label = 'Back' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-[1px] border border-line-strong bg-canvas transition-colors duration-200 ease-out hover:border-primary"
    >
      <Icon name="arrow_back" className="text-[18px] text-ink-muted transition-transform duration-200 ease-out group-hover:-translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

/** A labelled value in a specification grid. */
export function Fact({ label, value, wide = false }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">{label}</dt>
      <dd className="mt-2 text-[14px] leading-[1.4] text-ink">{value}</dd>
    </div>
  );
}

/** The product-wide empty state, under the name the portal already uses. */
export function EmptyState(props) {
  return <SharedEmptyState {...props} />;
}

/** Pager for a list sliced with `pageSlice`. Renders nothing for a single page. */
export function Pagination({ page, total, pageSize, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  const pagerButton =
    'rounded-[1px] border border-line-strong px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint disabled:hover:border-line disabled:hover:text-ink-faint';
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-dashed border-line px-5 py-3">
      <Meta className="text-ink-faint">Page {page} of {pages}</Meta>
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
        <div className="flex items-center gap-3 rounded-[1px] border border-primary bg-primary/[0.03] p-3">
          <Icon name={document.type === 'application/pdf' ? 'picture_as_pdf' : 'image'} className="text-[20px] text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink">{document.name}</span>
            <Meta className="mt-1 block text-ink-faint">{formatBytes(document.size)}</Meta>
          </span>
          <button type="button" onClick={onClear} className="font-mono text-[11px] uppercase tracking-[0.1em] text-primary hover:underline">
            Remove
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center gap-3 rounded-[1px] border border-dashed border-line-strong bg-canvas p-4 transition-colors duration-200 ease-out hover:border-primary">
          <Icon name="upload_file" className="text-[20px] text-primary" />
          <span className="text-[13px]">
            <span className="block font-medium text-ink">{prompt}</span>
            <span className="text-ink-muted">PDF, JPG or PNG up to 3 MB</span>
          </span>
          <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={onPick} />
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-primary">{error}</p>}
    </>
  );
}
