import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Meta from '@/components/ui/Meta';

/**
 * Confirmation for an action that is hard to undo.
 *
 * Replaces `window.confirm`, which cannot state consequences properly and
 * looks nothing like the rest of the product. The cancel button takes focus on
 * open, so pressing Enter out of habit does not confirm a destructive action.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  consequences = [],
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        onClick={onCancel}
        aria-hidden="true"
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="relative w-full max-w-lg border border-line bg-canvas p-7"
      >
        <span className="inline-flex items-center gap-3">
          <span className={`flex h-8 w-8 items-center justify-center rounded-[1px] ${destructive ? 'bg-primary text-white' : 'border border-dashed border-line-strong text-primary'}`}>
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              {destructive ? 'warning' : 'info'}
            </span>
          </span>
          <Meta className={destructive ? 'text-primary' : 'text-ink-muted'}>
            {destructive ? 'Confirm removal' : 'Please confirm'}
          </Meta>
        </span>

        <h2 id="confirm-dialog-title" className="mt-6 text-[22px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">
          {title}
        </h2>
        <p id="confirm-dialog-description" className="mt-3 text-[14px] leading-[1.6] text-ink-muted">
          {description}
        </p>

        {consequences.length > 0 && (
          <ul className="mt-6 border-t border-dashed border-line pt-5">
            {consequences.map((line) => (
              <li key={line.text} className="flex items-start gap-3 py-2">
                <span
                  className={`material-symbols-outlined mt-0.5 shrink-0 text-[16px] ${line.kept ? 'text-ink-faint' : 'text-primary'}`}
                  aria-hidden="true"
                >
                  {line.kept ? 'check' : 'block'}
                </span>
                <span className="text-[13px] leading-[1.5] text-ink-muted">{line.text}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[46px] items-center justify-center rounded-[1px] border border-dashed border-line-strong px-6 text-[14px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="group relative inline-flex min-h-[46px] items-center justify-center overflow-hidden rounded-[1px] bg-primary px-6 text-[14px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
            <span className="relative">{confirmLabel}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
