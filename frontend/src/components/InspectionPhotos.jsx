import { useState } from 'react';
import { INSPECTION_SHOTS, missingInspectionShots, stampPhoto } from '../utils/inspection';
import CameraCapture from './CameraCapture';

/**
 * The seven inspection tiles. The phone journey uses guided live capture;
 * the quote form uses a plain file input (`capture` makes phones open the
 * camera directly while desktops get a file picker).
 */
export default function InspectionPhotos({ photos = {}, plate = '', onPhoto, highlightMissing = false, footer = null, uploadOnly = false, captureAllLabel = null }) {
  const [activeKey, setActiveKey] = useState(null);
  const [sequence, setSequence] = useState(false);

  const missing = missingInspectionShots(photos);
  const activeShot = INSPECTION_SHOTS.find((shot) => shot.key === activeKey);
  const step = INSPECTION_SHOTS.findIndex((shot) => shot.key === activeKey) + 1;

  const startSequence = () => { setSequence(true); setActiveKey(missing[0]?.key || null); };

  const handleCapture = (key, dataUrl) => {
    onPhoto(key, dataUrl);
    if (!sequence) { setActiveKey(null); return; }
    const remaining = INSPECTION_SHOTS.filter((shot) => shot.key !== key && !photos[shot.key]);
    if (remaining.length) setActiveKey(remaining[0].key);
    else { setSequence(false); setActiveKey(null); }
  };

  const handleUpload = async (event, shot) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      onPhoto(shot.key, await stampPhoto(file, { plate, label: shot.label }));
    } finally {
      event.target.value = '';
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {INSPECTION_SHOTS.map((shot) => {
          const photo = photos[shot.key];
          const tileClass = `group relative flex min-h-32 flex-col items-center justify-center overflow-hidden rounded-xl border-2 p-3 text-center transition-colors ${photo ? 'border-primary/40 bg-primary/5' : highlightMissing ? 'border-dashed border-red-300 bg-red-50/40 text-red-900' : 'border-dashed border-primary/30 bg-white text-on-surface hover:border-primary/60'}`;
          const content = photo ? (
            <>
              <img src={photo} alt={shot.label} className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6 text-left text-[11px] font-bold text-white">{shot.label}</span>
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white"><span className="material-symbols-outlined text-[16px]" aria-hidden="true">check</span></span>
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[12px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">{uploadOnly ? 'Replace photo' : 'Retake'}</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-2xl" aria-hidden="true">{shot.icon}</span>
              <span className="mt-1 text-[12px] font-bold">{shot.label}</span>
              <span className="mt-0.5 text-[10px] text-secondary">{uploadOnly ? 'Tap to upload' : 'Tap to capture'}</span>
            </>
          );
          return (
            uploadOnly ? (
              <label key={shot.key} className={`${tileClass} cursor-pointer`}>
                {content}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => handleUpload(event, shot)} />
              </label>
            ) : (
              <button key={shot.key} type="button" onClick={() => { setSequence(false); setActiveKey(shot.key); }} className={tileClass}>
                {content}
              </button>
            )
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!uploadOnly && missing.length > 0 && (
          <button type="button" onClick={startSequence} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-bold text-white hover:bg-primary-container">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">photo_camera</span>
            {captureAllLabel || (missing.length === INSPECTION_SHOTS.length ? 'Capture all 7 photos' : `Capture remaining ${missing.length}`)}
          </button>
        )}
        {footer}
        <span className="text-[12px] text-secondary">{INSPECTION_SHOTS.length - missing.length} of {INSPECTION_SHOTS.length} captured</span>
      </div>

      {activeShot && (
        <CameraCapture
          shot={activeShot}
          plate={plate}
          step={step}
          total={INSPECTION_SHOTS.length}
          onCapture={handleCapture}
          onCancel={() => { setSequence(false); setActiveKey(null); }}
        />
      )}
    </>
  );
}
