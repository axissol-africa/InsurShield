import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { captureApi } from '../utils/captureApi';
import { INSPECTION_KEYS } from '../utils/inspection';

const POLL_MS = 2000;

/**
 * "Continue on your phone": opens a capture session, shows a QR code that
 * launches /capture/<code> on the phone, and streams the photos taken there
 * into this page as they arrive.
 */
export default function PhoneHandoff({ plate, onPhotos, onClose }) {
  const [session, setSession] = useState(null);
  const [link, setLink] = useState('');
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const received = useRef(new Set());

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

  useEffect(() => {
    if (!session) return undefined;
    const timer = setInterval(async () => {
      try {
        const latest = await captureApi.get(session.code);
        const fresh = Object.fromEntries(Object.entries(latest.photos).filter(([key]) => !received.current.has(key)));
        Object.keys(fresh).forEach((key) => received.current.add(key));
        if (Object.keys(fresh).length) onPhotos(fresh);
        setSession(latest);
        if (latest.status === 'complete') { clearInterval(timer); setTimeout(onClose, 800); }
      } catch (caught) {
        setError(caught.message);
        clearInterval(timer);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [session?.code, onPhotos, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = session ? Object.keys(session.photos).length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="handoff-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="handoff-title" className="text-[20px] font-extrabold">Continue on your phone</h2>
            <p className="mt-1 text-[13px] text-on-surface-variant">Scan with your phone camera. It opens the live capture for {plate || 'your vehicle'} — the photos appear here as you take them.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-gray-100"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
        </div>

        <div className="mt-5 flex flex-col items-center">
          {error ? (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-center text-[13px] text-red-700">{error}</p>
          ) : qr ? (
            <>
              <img src={qr} alt="QR code linking to the phone capture page" className="h-56 w-56 rounded-xl border border-slate-200" />
              <p className="mt-3 text-[12px] text-secondary">Or open this link on your phone:</p>
              <code className="mt-1 max-w-full break-all rounded-lg bg-slate-100 px-3 py-1.5 text-[12px] text-on-surface">{link}</code>
              <p className="mt-1 text-[11px] text-secondary">Code <strong className="font-mono">{session?.code}</strong> · valid for 30 minutes · same Wi-Fi network</p>
            </>
          ) : (
            <p className="text-[13px] text-secondary">Preparing your link…</p>
          )}
        </div>

        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-bold">{session?.status === 'complete' ? 'All photos received' : 'Waiting for photos…'}</span>
            <span className="text-secondary">{count} of {INSPECTION_KEYS.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(count / INSPECTION_KEYS.length) * 100}%` }} /></div>
        </div>
      </div>
    </div>
  );
}
