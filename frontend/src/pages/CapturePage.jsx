import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { captureApi } from '../utils/captureApi';
import { INSPECTION_SHOTS } from '../utils/inspection';
import InspectionPhotos from '../components/InspectionPhotos';

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
      <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-5">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <span className="material-symbols-outlined text-[48px] text-primary" aria-hidden="true">link_off</span>
          <h1 className="mt-3 text-[22px] font-extrabold">This link has expired</h1>
          <p className="mt-2 text-[14px] text-secondary">{error}</p>
        </section>
      </main>
    );
  }

  if (!session) return <main className="p-8 text-center text-secondary">Loading…</main>;

  const done = session.status === 'complete';

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8 pb-24">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Live vehicle photos</p>
        <h1 className="mt-1 text-[26px] font-extrabold tracking-[-.03em]">{session.plate ? `Photos for ${session.plate}` : 'Photos for your vehicle'}</h1>
        <p className="mt-2 text-[14px] text-on-surface-variant">Take each photo now with your phone camera. They appear on your computer automatically — keep this page open until all seven are done.</p>
      </header>

      {done ? (
        <section className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
          <span className="material-symbols-outlined text-[48px] text-primary" aria-hidden="true">task_alt</span>
          <h2 className="mt-2 text-[20px] font-extrabold text-on-primary-container">All photos sent</h2>
          <p className="mt-1 text-[14px] text-primary">Go back to your computer to finish the quote request. You can close this page.</p>
        </section>
      ) : (
        <div className="mt-6">
          <InspectionPhotos photos={session.photos} plate={session.plate} onPhoto={handlePhoto} />
          {sending && <p className="mt-3 text-[13px] text-secondary">Sending photo…</p>}
          {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>}
        </div>
      )}
    </main>
  );
}
