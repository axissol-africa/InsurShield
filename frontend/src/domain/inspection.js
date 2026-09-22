/**
 * Live inspection photos every insurer receives with a quote request.
 * Photos are captured with the camera at the time of the request (never picked
 * from a gallery) so insurers can rely on them instead of a physical inspection.
 */
export const INSPECTION_SHOTS = [
  { key: 'insp_front', label: 'Front view', icon: 'directions_car', hint: 'Stand back so the whole front, number plate and both headlights are in frame.' },
  { key: 'insp_back', label: 'Rear view', icon: 'directions_car', hint: 'Whole rear of the vehicle with the number plate readable.' },
  { key: 'insp_left', label: 'Left side', icon: 'directions_car', hint: 'Full left side from bumper to bumper.' },
  { key: 'insp_right', label: 'Right side', icon: 'directions_car', hint: 'Full right side from bumper to bumper.' },
  { key: 'insp_dashboard', label: 'Dashboard & mileage', icon: 'speed', hint: 'Ignition on so the odometer reading is visible.' },
  { key: 'insp_chassis', label: 'Chassis number', icon: 'qr_code_2', hint: 'The stamped VIN plate — usually under the bonnet, on the door pillar or under the windscreen.' },
  { key: 'insp_stereo', label: 'Car stereo / radio', icon: 'radio', hint: 'The centre console showing the radio or infotainment unit.' },
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
