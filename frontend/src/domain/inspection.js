/**
 * Live inspection photos every insurer receives with a quote request.
 * Photos are captured with the camera at the time of the request (never picked
 * from a gallery) so insurers can rely on them instead of a physical inspection.
 */
/**
 * Each shot carries what the assessor must be able to see, said plainly
 * enough that someone standing at their car can get it right first time.
 * `mustShow` is the single thing that decides whether the photo is usable —
 * it is what a rejected request comes back for.
 */
export const INSPECTION_SHOTS = [
  {
    key: 'insp_front',
    label: 'Front view',
    icon: 'directions_car',
    instruction: 'Stand about 3 steps back, facing the front of the car.',
    mustShow: 'The whole front, both headlights and the number plate',
    tip: 'Fill the frame with the car — no need to include the ground or sky.',
    frame: 'wide',
  },
  {
    key: 'insp_back',
    label: 'Rear view',
    icon: 'directions_car',
    instruction: 'Move to the back of the car and stand about 3 steps away.',
    mustShow: 'The whole rear with the number plate readable',
    tip: 'Straight on, not from an angle.',
    frame: 'wide',
  },
  {
    key: 'insp_left',
    label: 'Left side',
    icon: 'directions_car',
    instruction: "Stand at the driver's side, far enough back to see the whole car.",
    mustShow: 'The full left side, front bumper to rear bumper',
    tip: 'Hold the phone sideways (landscape) to fit the whole car in.',
    frame: 'wide',
  },
  {
    key: 'insp_right',
    label: 'Right side',
    icon: 'directions_car',
    instruction: 'Now the passenger side, again far enough back to see it all.',
    mustShow: 'The full right side, front bumper to rear bumper',
    tip: 'Hold the phone sideways (landscape) to fit the whole car in.',
    frame: 'wide',
  },
  {
    key: 'insp_dashboard',
    label: 'Dashboard and mileage',
    icon: 'speed',
    instruction: 'Switch the ignition on, then photograph the instrument cluster.',
    mustShow: 'The odometer reading — the number of kilometres on the clock',
    tip: 'Get close enough that the digits are readable, and avoid reflections on the glass.',
    frame: 'close',
  },
  {
    key: 'insp_chassis',
    label: 'Chassis number (VIN)',
    icon: 'qr_code_2',
    instruction: 'Find the stamped VIN plate — under the bonnet, on the door pillar when the door is open, or at the base of the windscreen.',
    mustShow: 'All 17 characters of the chassis number, in focus',
    tip: 'Wipe off any dust and get close. Use the flash if it sits in shadow.',
    frame: 'close',
  },
  {
    key: 'insp_stereo',
    label: 'Car stereo',
    icon: 'radio',
    instruction: 'Photograph the centre of the dashboard where the radio sits.',
    mustShow: 'The stereo or infotainment screen and the controls around it',
    tip: 'Switch it on if you can, so the screen is lit.',
    frame: 'close',
  },
];

export const INSPECTION_KEYS = INSPECTION_SHOTS.map((shot) => shot.key);

export const missingInspectionShots = (documents = {}) => INSPECTION_SHOTS.filter((shot) => !documents[shot.key]);

/** Longest edge for stored inspection photos — keeps seven JPEGs well inside browser storage limits. */
export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_QUALITY = 0.8;

/**
 * Downscale an image and stamp it with the capture time and plate so a photo
 * can only be used for the request it was taken for.
 * @param {Blob|string} source - File/Blob or an image data URL
 * @returns {Promise<string>} JPEG data URL
 */
export async function stampPhoto(source, { plate = '', label = '' } = {}) {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const stamp = `${label ? `${label} · ` : ''}${plate ? `${plate} · ` : ''}${new Date().toLocaleString('en-ZM', { dateStyle: 'medium', timeStyle: 'short' })} · InsurShield live capture`;
    const fontSize = Math.max(14, Math.round(canvas.width / 48));
    context.font = `bold ${fontSize}px Inter, sans-serif`;
    const padding = fontSize * 0.6;
    const textWidth = context.measureText(stamp).width;
    context.fillStyle = 'rgba(0,0,0,0.55)';
    context.fillRect(0, canvas.height - fontSize - padding * 2, textWidth + padding * 2, fontSize + padding * 2);
    context.fillStyle = '#fff';
    context.textBaseline = 'middle';
    context.fillText(stamp, padding, canvas.height - fontSize / 2 - padding);
    return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url);
  }
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
