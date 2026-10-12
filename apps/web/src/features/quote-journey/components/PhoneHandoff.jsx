import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { captureApi } from '@/api/capture';
import { INSPECTION_KEYS } from '@/domain/inspection';
import Meta from '@/components/ui/Meta';

const RECONCILE_POLL_MS = 1500;

const asDataUrl = async (source) => {
  if (!source || typeof source !== 'string') return null;
  if (source.startsWith('data:')) return source;
  const blob = await (await fetch(source)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The White Book could not be prepared for phone continuation.'));
    reader.readAsDataURL(blob);
  });
};

const portableJourney = async (journey) => {
  if (!journey) return null;
  // Blob URLs only exist in the browser that created them. Convert the White
  // Book before placing it in the short-lived hand-off session so the phone
  // can submit the same request without a "Failed to fetch" error.
  const whiteBook = await asDataUrl(journey.documents?.whiteBook);
  return { ...journey, documents: { ...journey.documents, whiteBook } };
};

/**
 * "Continue on your phone": opens a capture session, shows a QR code that
 * launches /capture/<code> on the phone, and streams the photos taken there
 * into this page as they arrive. The phone never signs in — the session code
 * in the QR is the authorisation, and it expires in 30 minutes.
 */
export default function PhoneHandoff({ plate, photos = {}, journey, onPhotos, onClose }) {
  const [session, setSession] = useState(null);
  const [link, setLink] = useState('');
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const received = useRef(new Set());
  const pollFailures = useRef(0);
  const closingAfterCompletion = useRef(false);
  const journeySnapshot = useRef(journey);
  // Freeze the missing set when the modal opens. The phone therefore asks
  // only for views that have not already been uploaded on this computer. If
  // the customer wants to use the phone again after all seven are present,
  // allow a fresh complete capture rather than making the QR option vanish.
  const requestedShotKeys = useRef((() => {
    const missing = INSPECTION_KEYS.filter((key) => !photos[key]);
    return missing.length ? missing : INSPECTION_KEYS;
  })());

  /** Hand each newly arrived photo up to the quote form exactly once. */
  const absorb = useCallback((incoming) => {
    const fresh = Object.fromEntries(Object.entries(incoming).filter(([key, value]) => value && !received.current.has(key)));
    if (!Object.keys(fresh).length) return;
    onPhotos(fresh);
    // Mark a photo as received only after the desktop has accepted it. If a
    // browser storage/rendering problem occurs, the next relay poll can retry
    // instead of silently dropping the rest of the session.
    Object.keys(fresh).forEach((key) => received.current.add(key));
  }, [onPhotos]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const draft = await portableJourney(journeySnapshot.current);
        const [origin, created] = await Promise.all([captureApi.host(), captureApi.create(plate, requestedShotKeys.current, draft)]);
        if (cancelled) return;
        const url = `${origin}/capture/${created.code}`;
        setSession(created);
        setLink(url);
        setQr(await QRCode.toDataURL(url, { margin: 1, width: 280, color: { dark: '#111827', light: '#ffffff' } }));
      } catch (caught) {
        if (!cancelled) setError(caught.message);
      }
    })();
    return () => { cancelled = true; };
  }, [plate]);

  const code = session?.code;

  // Each approved phone photo updates the corresponding laptop tile at once.
  // A reconnect still receives the latest session state.
  useEffect(() => {
    if (!code || typeof EventSource === 'undefined') return undefined;
    let stream;
    try {
      stream = captureApi.events(code);
    } catch {
      return undefined;
    }
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'session') { setSession(payload.session); absorb(payload.session.photos); }
      if (payload.type === 'photo') absorb({ [payload.key]: payload.dataUrl });
      if (payload.type === 'complete') {
        // A completion event can arrive immediately after the final image.
        // Fetch the authoritative session before unmounting the QR dialog so
        // a slow/lost final SSE photo frame cannot leave the computer at 6/7.
        if (closingAfterCompletion.current) return;
        closingAfterCompletion.current = true;
        void captureApi.get(code)
          .then((latest) => {
            setSession(latest);
            absorb(latest.photos);
            stream.close();
            onClose();
          })
          .catch((caught) => {
            // Keep the dialog and poll alive so a brief Wi-Fi interruption
            // cannot make the final image disappear from the desktop.
            closingAfterCompletion.current = false;
            setError(caught.message || 'The final photo could not be checked on this computer.');
          });
      }
      if (payload.type === 'expired') { setError('This capture link has expired. Close and start a new one.'); stream.close(); }
    };
    return () => stream.close();
  }, [code, absorb, onClose]);

  // Reconcile even when the event stream is open. This makes the laptop catch
  // up if Wi-Fi briefly drops an event while the phone is sending a photo.
  useEffect(() => {
    if (!code) return undefined;
    const timer = setInterval(async () => {
      try {
        const latest = await captureApi.get(code);
        pollFailures.current = 0;
        setSession(latest);
        absorb(latest.photos);
        if (latest.status === 'complete') {
          clearInterval(timer);
          onClose();
        }
      } catch (caught) {
        // One lost Wi-Fi request should not destroy an otherwise active QR
        // session. The capture client retries; only show a message after the
        // relay has been unavailable for several consecutive polls.
        pollFailures.current += 1;
        if (pollFailures.current >= 3) setError(caught.message);
      }
    }, RECONCILE_POLL_MS);
    return () => clearInterval(timer);
  }, [code, absorb, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="handoff-title">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto border border-line bg-canvas">
        <div className="flex items-start justify-between gap-4 border-b border-line p-6">
          <h2 id="handoff-title" className="text-[20px] font-semibold tracking-[-0.03em] text-ink">
            Scan to capture live photos
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-[1px] border border-dashed border-line-strong p-2 transition-colors duration-200 ease-out hover:border-primary hover:text-primary">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="p-6">
          {error ? (
            <p role="alert" className="border border-primary/30 bg-primary/[0.06] px-4 py-3 text-center text-[13px] text-primary">{error}</p>
          ) : qr ? (
            <div className="flex flex-col items-center">
              <img src={qr} alt="QR code linking to the phone capture page" className="h-52 w-52 border border-line" />

              <Meta className="mt-6 text-ink-faint">Or open on your phone</Meta>
              <code className="mt-2 max-w-full break-all text-center font-mono text-[12px] leading-[1.5] text-ink">{link}</code>
              <Meta className="mt-3 text-center text-ink-muted">
                Code <strong className="text-primary">{session?.code}</strong>
              </Meta>
              <Meta className="mt-1.5 text-center text-ink-faint">30 min · same Wi-Fi</Meta>

            </div>
          ) : (
            <Meta className="block py-20 text-center text-ink-muted">Preparing your link…</Meta>
          )}
        </div>
      </div>
    </div>
  );
}
