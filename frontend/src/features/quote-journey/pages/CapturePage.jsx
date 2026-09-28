import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { captureApi } from '@/api/capture';
import { INSPECTION_SHOTS } from '@/domain/inspection';
import InspectionPhotos from '@/features/quote-journey/components/InspectionPhotos';
import Meta from '@/components/ui/Meta';

/**
 * Phone side of the hand-off. Opened from the QR code on a laptop; no account
 * is needed because the short-lived session code is the authorisation. Each
 * photo is sent to the relay as soon as it is taken.
 */
export default function CapturePage() {
  const { code } = useParams();
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    captureApi.get(code).then(setSession).catch((caught) => setError(caught.message));
  }, [code]);

  const handlePhoto = useCallback(async (key, dataUrl) => {
    setSending(true);
    setError('');
    try {
      const updated = await captureApi.putPhoto(code, key, dataUrl);
      const allDone = INSPECTION_SHOTS.every((shot) => updated.photos[shot.key]);
      setSession(allDone ? await captureApi.complete(code) : updated);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSending(false);
    }
  }, [code]);

  if (error && !session) {
    return (
      <main className="relative overflow-hidden">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
        <div className="relative mx-auto flex min-h-[70vh] w-full max-w-[420px] items-center px-6 py-12">
          <section className="w-full border border-line bg-canvas p-8">
            <span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">link_off</span>
            <h1 className="mt-4 text-[24px] font-semibold tracking-[-0.03em] text-ink">This link has expired</h1>
            <p className="mt-3 text-[14px] leading-[1.6] text-ink-muted">{error}</p>
          </section>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="relative overflow-hidden">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
        <div className="relative flex min-h-[70vh] items-center justify-center px-6">
          <Meta className="text-ink-muted">Loading…</Meta>
        </div>
      </main>
    );
  }

  const done = session.status === 'complete';

  return (
    <main className="relative overflow-hidden">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-[680px] px-6 py-10 pb-24">
        <header className="border-b border-line pb-6">
          <span className="inline-flex items-center gap-3">
            <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
            <Meta className="text-ink-muted">Live vehicle photos</Meta>
          </span>
          <h1 className="mt-5 text-[28px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink">{session.plate ? `Photos for ${session.plate}` : 'Photos for your vehicle'}</h1>
          <p className="mt-4 text-[15px] leading-[1.6] text-ink-muted">Take each photo now with your phone camera. They appear on your computer automatically — keep this page open until all seven are done.</p>
        </header>

        {done ? (
          <section className="ticked mt-8 border border-primary bg-canvas p-8 text-center">
            <span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">task_alt</span>
            <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.03em] text-ink">All photos sent</h2>
            <p className="mt-3 text-[14px] leading-[1.6] text-ink-muted">Go back to your computer to finish the quote request. You can close this page.</p>
          </section>
        ) : (
          <div className="mt-8">
            <InspectionPhotos photos={session.photos} plate={session.plate} onPhoto={handlePhoto} />
            {sending && <Meta className="mt-4 block text-ink-muted">Sending photo…</Meta>}
            {error && <p role="alert" className="mt-4 border border-primary/30 bg-primary/[0.06] px-4 py-3 text-[13px] text-primary">{error}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
