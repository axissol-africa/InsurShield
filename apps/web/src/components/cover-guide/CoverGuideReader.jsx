import { useEffect } from 'react';
import Meta from '@/components/ui/Meta';
import CoverGuideDocument from './CoverGuideDocument';

/**
 * The cover guide, full screen, exactly as the insurer previewed it. Escape
 * closes it, because a customer reading a policy should never feel trapped in
 * it.
 */
export default function CoverGuideReader({ guide, insurerName, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={`${insurerName} cover guide`}>
      <div className="mx-auto w-full max-w-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border border-line bg-canvas px-5 py-3">
          <Meta className="text-ink-muted">Cover guide</Meta>
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-ink transition-colors duration-200 ease-out hover:text-primary">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>Close
          </button>
        </div>
        <CoverGuideDocument guide={guide} coverType={guide.coverageType || guide.coverType} insurerName={insurerName} className="border-t-0" />
      </div>
    </div>
  );
}
