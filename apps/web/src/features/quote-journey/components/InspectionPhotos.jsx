import { useState } from 'react';
import { INSPECTION_SHOTS, missingInspectionShots, stampPhoto } from '@/domain/inspection';
import { assessPhoto } from '@/domain/photoQuality';

/**
 * The seven inspection tiles on the quote form.
 *
 * Every tile states what has to be visible in that photo, and every photo is
 * graded the moment it is chosen: one that is blurry, badly lit or pointed at
 * the wrong thing is refused here with the reason, instead of by an insurer
 * next week. Nobody is asked to certify their own photo — the check is the
 * same one the guided phone capture applies, so both routes hold the same bar.
 *
 * `capture` makes a phone open its camera straight away; a computer gets a
 * file picker.
 */
export default function InspectionPhotos({ photos = {}, plate = '', onPhoto, onRemove, highlightMissing = false }) {
  const [checking, setChecking] = useState(null);
  const [rejections, setRejections] = useState({});

  const missing = missingInspectionShots(photos);

  const note = (key, message) => setRejections((current) => ({ ...current, [key]: message }));

  const handleUpload = async (event, shot) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setChecking(shot.key);
    note(shot.key, null);
    try {
      const stamped = await stampPhoto(file, { plate, label: shot.label });
      const assessment = await assessPhoto(stamped, shot);
      if (!assessment.ok) {
        note(shot.key, assessment.messages[0]);
        return;
      }
      onPhoto(shot.key, stamped);
    } catch (error) {
      note(shot.key, error.message || 'That photo could not be read. Please choose another one.');
    } finally {
      setChecking(null);
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {INSPECTION_SHOTS.map((shot) => {
          const photo = photos[shot.key];
          const rejected = rejections[shot.key];
          const busy = checking === shot.key;
          const border = photo
            ? 'border-primary/40 bg-primary/5'
            : rejected
              ? 'border-primary bg-primary/[0.06] text-primary'
              : highlightMissing
                ? 'border-dashed border-primary/30 bg-primary/[0.06] text-primary'
                : 'border-dashed border-primary/30 bg-white text-ink hover:border-primary/60';

          return (
            <div key={shot.key} className="relative">
              <label className={`group relative flex min-h-36 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[1px] border-2 p-3 text-center transition-colors ${border}`}>
                {photo ? (
                  <>
                    <img src={photo} alt={shot.label} className="absolute inset-0 h-full w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6 text-left text-[11px] font-medium text-white">{shot.label}</span>
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">check</span>
                    </span>
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[12px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">Replace photo</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-2xl" aria-hidden="true">{shot.icon}</span>
                    <span className="mt-1 text-[12px] font-medium leading-tight">{shot.label}</span>
                    {/* The one thing that decides whether this photo is usable. */}
                    <span className="mt-1 text-[10px] leading-[1.35] text-ink-muted">{shot.mustShow}</span>
                  </>
                )}

                {busy && (
                  <span className="absolute inset-0 flex items-center justify-center bg-ink/70 text-white">
                    <span className="material-symbols-outlined animate-spin text-[26px]" aria-hidden="true">sync</span>
                  </span>
                )}

                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => handleUpload(event, shot)} disabled={busy} />
              </label>

              {photo && onRemove && (
                <button
                  type="button"
                  onClick={() => { onRemove(shot.key); note(shot.key, null); }}
                  className="absolute left-2 top-2 z-10 inline-flex min-h-7 items-center gap-1 rounded-[1px] bg-white/95 px-2 text-[10px] font-medium text-primary shadow-sm hover:bg-white"
                  aria-label={`Remove ${shot.label} photo`}
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">delete</span>Remove
                </button>
              )}

              {rejected && (
                <p role="alert" className="mt-1.5 text-[11px] leading-[1.4] text-primary">{rejected}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[12px] text-ink-muted">{INSPECTION_SHOTS.length - missing.length} of {INSPECTION_SHOTS.length} captured</span>
        <span className="text-[12px] text-ink-faint">Each photo is checked for focus and lighting before it is accepted.</span>
      </div>
    </>
  );
}
