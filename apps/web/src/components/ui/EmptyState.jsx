/**
 * What a list looks like before anything is in it.
 *
 * An empty area is where a product most easily looks unfinished, so every one
 * of them here is the same object: a dashed frame — the same dashed rule used
 * for anything not yet filled in — a framed icon, one line saying what will
 * appear, and, where there is something useful to do, one action.
 */
export default function EmptyState({ icon, title, hint, action = null, className = '' }) {
  return (
    <div className={`border border-dashed border-line-strong bg-canvas-2 p-10 text-center sm:p-12 ${className}`}>
      <span className="mx-auto flex h-14 w-14 items-center justify-center border border-line-strong bg-canvas">
        <span className="material-symbols-outlined text-[26px] text-primary" aria-hidden="true">{icon}</span>
      </span>
      <p className="mt-5 text-[18px] font-semibold tracking-[-0.02em] text-ink">{title}</p>
      {hint && <p className="mx-auto mt-3 max-w-sm text-[14px] leading-[1.6] text-ink-muted">{hint}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
