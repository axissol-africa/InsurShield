import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { captureApi } from '@/api/capture';
import { INSPECTION_SHOTS } from '@/domain/inspection';
import GuidedCapture from '@/features/quote-journey/components/GuidedCapture';
import { ArrowRight, CheckCircle2, Link2Off, LoaderCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Alert, AlertDescription } from '@/components/ui/primitives/alert';

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
        <Card>
          <CardHeader>
            <Link2Off className="mb-2 size-6 text-primary" aria-hidden="true" />
            <CardTitle><h1 className="text-xl">Photo session unavailable</h1></CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">Go back to your computer and choose <strong className="font-medium text-foreground">Continue on my phone</strong> again for a fresh link.</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <Card><CardContent className="flex items-center justify-center gap-3 py-8" role="status">
          <LoaderCircle className="size-5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">Loading photo session…</span>
        </CardContent></Card>
      </Shell>
    );
  }

  if (session.status === 'complete') {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CheckCircle2 className="mb-2 size-7 text-primary" aria-hidden="true" />
            <CardTitle><h1 className="text-2xl">Photos sent</h1></CardTitle>
            <CardDescription className="leading-relaxed">All {session.shots?.length || INSPECTION_SHOTS.length} live vehicle photos have been sent to your quote request. Return to your computer to continue.</CardDescription>
          </CardHeader>
          {session.journey && <CardContent className="space-y-3">
            <Button asChild size="lg" className="min-h-11 w-full whitespace-normal">
              <Link to={`/quote-request?capture=${encodeURIComponent(code)}`}>Continue quote on this phone<ArrowRight aria-hidden="true" /></Link>
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">Sign in on this phone if asked. Your vehicle details and live photos will be restored.</p>
          </CardContent>}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Vehicle photos</h1>
        <p className="mt-2 text-sm text-muted-foreground">{session.plate || 'Your vehicle'}</p>
      </header>
      {allPhotosCaptured ? (
        <Card>
          <CardHeader>
            {!error && <LoaderCircle className="mb-2 size-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />}
            <CardTitle><h2 className="text-xl">{error ? 'Almost done' : `Sending your ${requestedShots.length === 1 ? 'photo' : 'photos'}…`}</h2></CardTitle>
            {!error && <CardDescription role="status">All {requestedShots.length} accepted, and already on your computer.</CardDescription>}
          </CardHeader>
          {error && <CardContent className="space-y-4">
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            <Button type="button" size="lg" onClick={() => { setError(''); void finishCapture(); }} className="min-h-11 w-full"><RotateCcw aria-hidden="true" />Try again</Button>
          </CardContent>}
        </Card>
      ) : (
        <GuidedCapture photos={photos} plate={session.plate} onPhoto={savePhoto} shotKeys={requestedShotKeys} />
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return <section className="mx-auto w-full max-w-xl px-4 py-8 pb-16 sm:px-6">{children}</section>;
}
