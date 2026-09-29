import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { captureApi } from '@/api/capture';
import { INSPECTION_SHOTS } from '@/domain/inspection';
import GuidedCapture from '@/features/quote-journey/components/GuidedCapture';
import Meta from '@/components/ui/Meta';

/**
 * Phone side of the hand-off. Opened from the QR code on a laptop; no account
 * is needed because the short-lived session code is the authorisation.
 *
 * One photo at a time, in order. Each photo is checked as it is taken and
 * relayed straight away, so the matching tile on the computer fills in live
 * and the hand-off closes itself once the last one is accepted. There is
 * nothing to confirm at the end: every photo was already judged and accepted
 * in front of the customer, and asking again would only be a second chance to
 * say no to work they have already done. A hand-off can contain only the
 * views still missing on the laptop.
 */

/**
 * Sessions created before the missing-photo hand-off was introduced still
 * carry the complete shot list. The fallback also keeps an older valid session
 * usable instead of leaving the customer on a blank capture page.
 */
const requestedKeys = (session) => (session?.shots?.length ? session.shots : INSPECTION_SHOTS.map((shot) => shot.key));
const hasEveryPhoto = (session) => requestedKeys(session).every((key) => session?.photos?.[key]);

export default function CapturePage() {
  const { code } = useParams();
  const [session, setSession] = useState(null);
  const [photos, setPhotos] = useState({});
  const [error, setError] = useState('');
  const finishing = useRef(false);

  /**
   * Close the hand-off. The guard is a ref rather than state so that no
   * re-render can send a second completion, and it is released on failure so
   * the retry below can try again.
   */
  const finishCapture = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      setSession(await captureApi.complete(code));
    } catch (caught) {
      finishing.current = false;
      setError(caught.message || 'Your photos are saved, but the capture could not be closed. Please try again.');
    }
  }, [code]);

  useEffect(() => {
    captureApi.get(code)
      .then(async (loaded) => {
        setSession(loaded);
        setPhotos(loaded.photos || {});
        // Reopened after the last photo was relayed but before the hand-off
        // could be closed: finish it instead of stranding the customer.
        if (loaded.status !== 'complete' && hasEveryPhoto(loaded)) await finishCapture();
      })
      .catch((caught) => setError(caught.message));
  }, [code, finishCapture]);

  const savePhoto = useCallback(async (key, dataUrl) => {
    const updated = await captureApi.putPhoto(code, key, dataUrl);
    setSession(updated);
    setPhotos(updated.photos || {});
    // The photo that completes the set ends the hand-off by itself.
    if (hasEveryPhoto(updated)) await finishCapture();
  }, [code, finishCapture]);

  const requestedShotKeys = requestedKeys(session);
  const requestedShots = INSPECTION_SHOTS.filter((shot) => requestedShotKeys.includes(shot.key));
  const allPhotosCaptured = Boolean(session) && requestedShots.every((shot) => photos[shot.key]);

  if (error && !session) {
    return (
      <Shell>
        <section className="w-full border border-line bg-canvas p-8">
          <span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">link_off</span>
          <h1 className="mt-4 text-[24px] font-semibold tracking-[-0.03em] text-ink">This link has expired</h1>
          <p className="mt-3 text-[14px] leading-[1.6] text-ink-muted">{error}</p>
          <p className="mt-4 text-[14px] leading-[1.6] text-ink-muted">
            Go back to your computer and choose <strong className="font-medium text-ink">Continue on my phone</strong> again for a fresh link.
          </p>
        </section>
      </Shell>
    );
  }

  if (!session) {
    return <Shell><Meta className="text-ink-muted">Loading…</Meta></Shell>;
  }

  if (session.status === 'complete') {
    return (
      <Shell>
        <section className="w-full border border-primary/25 bg-white p-8 text-center">
          <span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">task_alt</span>
          <h1 className="mt-4 text-[24px] font-semibold tracking-[-0.03em] text-ink">Photos sent</h1>
          <p className="mt-3 text-[14px] leading-[1.6] text-ink-muted">All {session.shots?.length || INSPECTION_SHOTS.length} live vehicle photos have been sent to your quote request. Return to your computer to continue.</p>
          {session.journey && <Link to={`/quote-request?capture=${encodeURIComponent(code)}`} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[1px] bg-primary px-5 text-[15px] font-medium text-white hover:bg-[#b91c1c]">
            Continue quote on this phone <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
          </Link>}
          {session.journey && <p className="mt-3 text-[12px] leading-[1.5] text-ink-faint">Sign in on this phone if asked. Your vehicle details and live photos will be restored.</p>}
        </section>
      </Shell>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-[520px] px-5 py-8 pb-16">
        <header className="border-b border-line pb-5">
          <Meta className="text-primary">Vehicle photos</Meta>
          <h1 className="mt-3 text-[20px] font-semibold leading-[1.2] tracking-[-0.03em] text-ink">
            {session.plate || 'Your vehicle'}
          </h1>
        </header>

        <div className="mt-7">
          {allPhotosCaptured ? (
            <section className="border border-primary/25 bg-white p-6 text-center">
              <span className={`material-symbols-outlined text-[40px] text-primary ${error ? '' : 'animate-spin'}`} aria-hidden="true">{error ? 'error' : 'sync'}</span>
              <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.03em] text-ink">
                {error ? 'Almost done' : `Sending your ${requestedShots.length === 1 ? 'photo' : 'photos'}…`}
              </h2>
              {error ? (
                <>
                  <p role="alert" className="mt-3 text-[14px] leading-[1.6] text-primary">{error}</p>
                  <button type="button" onClick={() => { setError(''); void finishCapture(); }} className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-[1px] bg-primary text-[16px] font-medium text-white hover:bg-[#b91c1c]">
                    <span className="material-symbols-outlined" aria-hidden="true">refresh</span>Try again
                  </button>
                </>
              ) : (
                <p className="mt-3 text-[14px] leading-[1.6] text-ink-muted">All {requestedShots.length} accepted, and already on your computer.</p>
              )}
            </section>
          ) : (
            <GuidedCapture photos={photos} plate={session.plate} onPhoto={savePhoto} shotKeys={requestedShotKeys} />
          )}
        </div>
      </div>
    </main>
  );
}

function Shell({ children }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
      <div className="relative mx-auto flex min-h-[70vh] w-full max-w-[420px] items-center justify-center px-6 py-12">
        {children}
      </div>
    </main>
  );
}
