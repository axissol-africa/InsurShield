import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { captureApi } from '@/api/capture';
import { INSPECTION_KEYS, INSPECTION_SHOTS } from '@/domain/inspection';
import Meta from '@/components/ui/Meta';

/** Only used if the live stream cannot be opened (no EventSource, proxy strips SSE). */
const FALLBACK_POLL_MS = 2000;
const CLOSE_DELAY_MS = 1200;

/** What the laptop is doing right now, in the customer's terms. */
const statusLabel = (done, live, count) => {
  if (done) return 'All photos received';
  if (!live) return 'Waiting for your phone';
  if (!count) return 'Connected · waiting for photos';
  const left = INSPECTION_KEYS.length - count;
  return left ? `Receiving · ${left} still to come` : 'All photos received';
};

/**
 * "Continue on your phone": opens a capture session, shows a QR code that
 * launches /capture/<code> on the phone, and streams the photos taken there
 * into this page as they arrive. The phone never signs in — the session code
 * in the QR is the authorisation, and it expires in 30 minutes.
 */
export default function PhoneHandoff({ plate, onPhotos, onClose }) {
  const [session, setSession] = useState(null);
  const [photos, setPhotos] = useState({});
  const [link, setLink] = useState('');
  const [qr, setQr] = useState('');
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const received = useRef(new Set());

  /** Hand each newly arrived photo up to the quote form exactly once. */
  const absorb = useCallback((incoming) => {
    const fresh = Object.fromEntries(Object.entries(incoming).filter(([key, value]) => value && !received.current.has(key)));
    if (!Object.keys(fresh).length) return;
    Object.keys(fresh).forEach((key) => received.current.add(key));
    setPhotos((current) => ({ ...current, ...fresh }));
    onPhotos(fresh);
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
        const [origin, created] = await Promise.all([captureApi.host(), captureApi.create(plate, INSPECTION_KEYS)]);
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

  // Live stream: each photo lands the moment the phone sends it.
  useEffect(() => {
    if (!code || typeof EventSource === 'undefined') return undefined;
    let stream;
    try {
      stream = captureApi.events(code);
    } catch {
      return undefined;
    }
    stream.onopen = () => setLive(true);
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'session') { setSession(payload.session); absorb(payload.session.photos); }
      if (payload.type === 'photo') absorb({ [payload.key]: payload.dataUrl });
      if (payload.type === 'complete') {
        setSession((current) => (current ? { ...current, status: 'complete' } : current));
        stream.close();
        setTimeout(onClose, CLOSE_DELAY_MS);
      }
      if (payload.type === 'expired') { setError('This capture link has expired. Close and start a new one.'); stream.close(); }
    };
    // A dropped stream is not an error the customer needs to see: the poll below covers it.
    stream.onerror = () => setLive(false);
    return () => stream.close();
  }, [code, absorb, onClose]);

  // Fallback only — runs while the stream is not connected.
  useEffect(() => {
    if (!code || live) return undefined;
    const timer = setInterval(async () => {
      try {
        const latest = await captureApi.get(code);
        absorb(latest.photos);
        setSession(latest);
        if (latest.status === 'complete') { clearInterval(timer); setTimeout(onClose, CLOSE_DELAY_MS); }
      } catch (caught) {
        setError(caught.message);
        clearInterval(timer);
      }
    }, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [code, live, absorb, onClose]);

  const count = Object.keys(photos).length;
  const done = session?.status === 'complete';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="handoff-title">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto border border-line bg-canvas">
        <div className="flex items-start justify-between gap-4 border-b border-line p-6">
          <div>
            <Meta className="text-primary">Continue on your phone</Meta>
            <h2 id="handoff-title" className="mt-3 text-[22px] font-semibold tracking-[-0.03em] text-ink">Scan to capture live photos</h2>
            <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.55] text-ink-muted">
              Scan with your phone camera. It opens the live capture for {plate || 'your vehicle'} — no sign-in
              needed, and each photo appears here the moment you take it.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-[1px] border border-dashed border-line-strong p-2 transition-colors duration-200 ease-out hover:border-primary hover:text-primary">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[260px_1fr]">
          {/* ── The link ──────────────────────────────────────── */}
          <div className="flex flex-col items-center border border-dashed border-line-strong p-5">
            {error ? (
              <p role="alert" className="border border-primary/30 bg-primary/[0.06] px-4 py-3 text-center text-[13px] text-primary">{error}</p>
            ) : qr ? (
              <>
                <img src={qr} alt="QR code linking to the phone capture page" className="h-44 w-44 border border-line" />
                <Meta className="mt-5 text-ink-faint">Or open on your phone</Meta>
                <code className="mt-2 max-w-full break-all bg-canvas-2 px-2.5 py-1.5 text-center font-mono text-[11px] leading-[1.5] text-ink">{link}</code>
                <Meta className="mt-4 text-center text-ink-muted">
                  Code <strong className="text-primary">{session?.code}</strong>
                </Meta>
                <Meta className="mt-1.5 text-center text-ink-faint">30 min · same Wi-Fi</Meta>
              </>
            ) : (
              <Meta className="py-16 text-ink-muted">Preparing your link…</Meta>
            )}
          </div>

          {/* ── What has arrived ──────────────────────────────── */}
          <div>
            <div className="flex items-end justify-between gap-4 border-b border-dashed border-line pb-3">
              <span className="inline-flex items-center gap-3">
                {!done && <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />}
                <Meta className={done ? 'text-primary' : 'text-ink-muted'}>{statusLabel(done, live, count)}</Meta>
              </span>
              <Meta className="text-ink-faint">{count} / {INSPECTION_KEYS.length}</Meta>
            </div>

            <div className="mt-3 h-1 overflow-hidden bg-line">
              <div className="h-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${(count / INSPECTION_KEYS.length) * 100}%` }} />
            </div>

            <ul className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {INSPECTION_SHOTS.map((shot) => {
                const photo = photos[shot.key];
                return (
                  <li key={shot.key} className={`relative flex min-h-[84px] flex-col items-center justify-center overflow-hidden border p-2 text-center ${photo ? 'border-primary' : 'border-dashed border-line-strong'}`}>
                    {photo ? (
                      <>
                        <img src={photo} alt={shot.label} className="absolute inset-0 h-full w-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1.5 pt-5 text-left text-[10px] font-medium leading-tight text-white">{shot.label}</span>
                        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white">
                          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[20px] text-line-strong" aria-hidden="true">{shot.icon}</span>
                        <span className="mt-1.5 text-[10px] leading-tight text-ink-faint">{shot.label}</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="mt-5 text-[12px] leading-[1.55] text-ink-muted">
              Keep this window open. You can close it at any time — the photos already received stay on your request.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
