import { useCallback, useEffect, useRef, useState } from 'react';
import { INSPECTION_SHOTS, stampPhoto } from '@/domain/inspection';
import { assessPhoto } from '@/domain/photoQuality';
import Progress from '@/components/ui/Progress';
import { cn } from '@/lib/cn';

/**
 * Guided capture of the seven inspection photos, one at a time.
 *
 * The customer is shown one instruction, takes one photo, and moves on. There
 * is no checklist to read and nothing to confirm: the photo is graded the
 * moment it is taken, and either it is accepted and the next shot begins, or
 * the customer is told exactly what went wrong and takes it again. Asking
 * someone to tick "this photo is clear" only moves the judgement onto the
 * person least able to make it.
 */

/** Long enough to register the tick, short enough not to feel like waiting. */
const ACCEPTED_PAUSE_MS = 900;

export default function GuidedCapture({ photos = {}, plate = '', onPhoto, onDone, only = null, shotKeys = null }) {
  // Retaking one shot is the same flow, one step long.
  const [retaken, setRetaken] = useState(false);
  // A QR hand-off can ask for only the views that are still missing on the
  // computer. Direct phone capture leaves this unset and keeps the full set.
  const requestedShots = shotKeys
    ? INSPECTION_SHOTS.filter((candidate) => shotKeys.includes(candidate.key))
    : INSPECTION_SHOTS;
  const queue = only
    ? requestedShots.filter((candidate) => candidate.key === only && !retaken)
    : requestedShots.filter((candidate) => !photos[candidate.key]);

  const shot = queue[0];
  const total = only ? 1 : requestedShots.length;
  const captured = only ? Number(retaken) : requestedShots.length - queue.length;
  const capturing = Boolean(shot);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [mode, setMode] = useState(() =>
    typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia && window.isSecureContext
      ? 'live'
      : 'fallback',
  );
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(null);
  const [accepted, setAccepted] = useState(false);

  // One camera stream for the whole run: reopening it between shots is slow
  // on a phone and makes the flow feel like seven separate tasks.
  useEffect(() => {
    if (mode !== 'live' || !capturing) return undefined;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => { if (!cancelled) setMode('fallback'); });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [mode, capturing]);

  /** Grade the photo, then either keep it and move on, or explain the problem. */
  const submit = useCallback(async (source) => {
    setBusy(true);
    setRejected(null);
    try {
      const stamped = await stampPhoto(source, { plate, label: shot.label });
      const assessment = await assessPhoto(stamped, shot);

      if (!assessment.ok) {
        setRejected(assessment.messages[0]);
        return;
      }

      setAccepted(true);
      await onPhoto(shot.key, stamped);
      if (only) setRetaken(true);
      setTimeout(() => setAccepted(false), ACCEPTED_PAUSE_MS);
    } catch (error) {
      setRejected(error.message || 'That photo could not be read. Please take it again.');
    } finally {
      setBusy(false);
    }
  }, [onPhoto, plate, shot, only]);

  const takeLivePhoto = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    await submit(canvas.toDataURL('image/jpeg', 0.92));
  };

  const takeFromCameraApp = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await submit(file);
  };

  if (!shot) {
    return (
      <section className="border border-primary bg-canvas p-8 text-center">
        <span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">task_alt</span>
        <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.03em] text-ink">
          {only ? 'Photo replaced' : `All ${total} ${total === 1 ? 'photo' : 'photos'} sent`}
        </h2>
        <p className="mt-3 text-[14px] leading-[1.6] text-ink-muted">
          {only
            ? 'The new photo is on your request.'
            : 'They have gone straight to your quote request. You can close this page.'}
        </p>
        {onDone && (
          <button type="button" onClick={onDone} className="mt-6 min-h-12 rounded-[1px] border border-line-strong px-6 text-[15px] font-medium text-ink">
            Done
          </button>
        )}
      </section>
    );
  }

  return (
    <section aria-live="polite">
      {/* Where you are, in one line. */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted">
          {only ? 'Retake' : `Photo ${captured + 1} of ${total}`}
        </span>
        <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-faint">
          {only ? shot.label : `${captured} done`}
        </span>
      </div>
      <Progress value={(captured / total) * 100} className="mt-3 h-1" />

      {/* What to photograph. */}
      <h2 className="mt-6 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink">{shot.label}</h2>
      <p className="mt-3 text-[15px] leading-[1.6] text-ink-muted">{shot.instruction}</p>

      <p className="mt-4 flex items-start gap-2.5 border border-dashed border-line-strong bg-canvas-2 p-3.5 text-[14px] leading-[1.5] text-ink">
        <span className="material-symbols-outlined shrink-0 text-[20px] text-primary" aria-hidden="true">center_focus_strong</span>
        <span><strong className="font-medium">Must be visible:</strong> {shot.mustShow}</span>
      </p>

      {/* The camera. */}
      <div className="relative mt-5 aspect-[4/3] overflow-hidden bg-ink">
        {mode === 'live' ? (
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="material-symbols-outlined text-[56px] text-white/70" aria-hidden="true">photo_camera</span>
            <p className="mt-3 text-[14px] text-white/85">Tap below to open your camera.</p>
          </div>
        )}

        {/* Framing guide: where the subject should sit. */}
        {mode === 'live' && (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute rounded-[2px] border-2 border-dashed border-white/60',
              shot.frame === 'close' ? 'inset-x-[18%] inset-y-[26%]' : 'inset-x-[6%] inset-y-[14%]',
            )}
          />
        )}

        {accepted && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-primary/90 text-white">
            <span className="material-symbols-outlined text-[52px]" aria-hidden="true">check_circle</span>
            <p className="mt-2 text-[16px] font-medium">Photo accepted</p>
          </div>
        )}
        {busy && !accepted && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/70 text-white">
            <span className="material-symbols-outlined animate-spin text-[34px]" aria-hidden="true">sync</span>
          </div>
        )}
      </div>

      <p className="mt-3 text-[13px] leading-[1.5] text-ink-muted">{shot.tip}</p>

      {rejected && (
        <p role="alert" className="mt-4 flex items-start gap-2.5 border border-primary/30 bg-primary/[0.06] p-3.5 text-[14px] leading-[1.5] text-primary">
          <span className="material-symbols-outlined shrink-0 text-[20px]" aria-hidden="true">error</span>
          <span>{rejected}</span>
        </p>
      )}

      {mode === 'live' ? (
        <button
          type="button"
          onClick={takeLivePhoto}
          disabled={busy}
          className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-[1px] bg-primary text-[16px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:opacity-60"
        >
          <span className="material-symbols-outlined" aria-hidden="true">photo_camera</span>
          {busy ? 'Checking…' : rejected ? 'Take it again' : `Take the ${shot.label.toLowerCase()}`}
        </button>
      ) : (
        <label className="mt-5 flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-[1px] bg-primary text-[16px] font-medium text-white hover:bg-[#b91c1c]">
          <span className="material-symbols-outlined" aria-hidden="true">photo_camera</span>
          {busy ? 'Checking…' : rejected ? 'Take it again' : 'Open camera'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={takeFromCameraApp} disabled={busy} />
        </label>
      )}

      <p className="mt-4 text-center text-[12px] leading-[1.5] text-ink-faint">
        Each photo is checked for focus and lighting before it is sent, and stamped with the date, time and plate.
      </p>
    </section>
  );
}
