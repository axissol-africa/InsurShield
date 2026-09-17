import { useEffect, useRef, useState } from 'react';
import { stampPhoto } from '../utils/inspection';

/**
 * Guided live capture of one inspection shot.
 *
 * Uses the device camera through getUserMedia so the photo is taken now, not
 * chosen from a gallery. Where the page is not a secure context (plain http
 * over the LAN) getUserMedia is unavailable, so it falls back to the camera
 * app via <input capture="environment">. Every photo is stamped with the
 * capture time and plate before it is returned.
 */
export default function CameraCapture({ shot, plate, step, total, onCapture, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [mode, setMode] = useState(() => (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia && window.isSecureContext ? 'live' : 'fallback'));
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    if (mode !== 'live') return undefined;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => { if (!cancelled) setMode('fallback'); });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [mode, shot.key]);

  const snap = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setWorking(true);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    setPreview(await stampPhoto(canvas.toDataURL('image/jpeg', 0.92), { plate, label: shot.label }));
    setWorking(false);
  };

  const fromFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setWorking(true);
    setError('');
    try {
      setPreview(await stampPhoto(file, { plate, label: shot.label }));
    } catch {
      setError('That photo could not be read. Please try again.');
    } finally {
      setWorking(false);
      event.target.value = '';
    }
  };

  const accept = () => { onCapture(shot.key, preview); setPreview(null); };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-labelledby="capture-title">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={onCancel} className="rounded-full p-2 hover:bg-white/10" aria-label="Close camera"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
        <div className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/60">Photo {step} of {total}</p>
          <h2 id="capture-title" className="text-[17px] font-extrabold">{shot.label}</h2>
        </div>
        <span className="w-10" aria-hidden="true" />
      </header>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {preview ? (
          <img src={preview} alt={`${shot.label} preview`} className="max-h-full max-w-full object-contain" />
        ) : mode === 'live' ? (
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        ) : (
          <div className="px-8 text-center">
            <span className="material-symbols-outlined text-[72px] text-white/70" aria-hidden="true">photo_camera</span>
            <p className="mt-3 text-[15px] text-white/85">Open your camera to take this photo now.</p>
          </div>
        )}
        {!preview && <p className="pointer-events-none absolute inset-x-4 bottom-4 rounded-xl bg-black/60 px-4 py-3 text-center text-[13px] leading-5 text-white/90">{shot.hint}</p>}
      </div>

      <footer className="space-y-3 px-4 py-4">
        {error && <p role="alert" className="rounded-xl bg-red-500/20 px-4 py-2 text-center text-[13px] text-red-100">{error}</p>}
        {preview ? (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setPreview(null)} className="min-h-12 rounded-xl border border-white/40 font-bold">Retake</button>
            <button type="button" onClick={accept} className="min-h-12 rounded-xl bg-primary font-bold hover:bg-primary-container">Use this photo</button>
          </div>
        ) : mode === 'live' ? (
          <button type="button" onClick={snap} disabled={working} className="mx-auto flex h-18 w-18 items-center justify-center rounded-full border-4 border-white/80 bg-white/10 disabled:opacity-50" aria-label="Take photo">
            <span className="h-14 w-14 rounded-full bg-white" />
          </button>
        ) : (
          <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-bold hover:bg-primary-container">
            <span className="material-symbols-outlined" aria-hidden="true">photo_camera</span>{working ? 'Processing…' : 'Open camera'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={fromFile} disabled={working} />
          </label>
        )}
        <p className="text-center text-[11px] text-white/50">Photos are stamped with the date, time and plate. Gallery images are not accepted.</p>
      </footer>
    </div>
  );
}
