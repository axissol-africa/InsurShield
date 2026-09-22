/** Small helpers for turning uploaded files into storable data URLs. */

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });

/**
 * Read an image and shrink it so the longest edge is at most `maxEdge` pixels.
 * Keeps PNG transparency for logos; everything else becomes JPEG.
 */
export async function imageToDataUrl(file, { maxEdge = 400 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (PNG, JPG or SVG).');
  if (file.type === 'image/svg+xml') return readAsDataUrl(file);
  const source = await readAsDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be decoded.'));
    img.src = source;
  });
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const keepAlpha = file.type === 'image/png';
  return canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.85);
}

export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/**
 * Read a quote document (PDF or image) for storage against a request.
 * @returns {Promise<{ name: string, type: string, size: number, dataUrl: string }>}
 */
export async function documentToRecord(file) {
  if (!DOCUMENT_TYPES.includes(file.type)) throw new Error('Upload the quote as a PDF, JPG or PNG.');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`);
  return { name: file.name, type: file.type, size: file.size, dataUrl: await readAsDataUrl(file) };
}

/** Open a stored document in a new tab (data URLs cannot be opened directly, so a blob URL is minted). */
export function openDocument(record) {
  const [header, base64] = record.dataUrl.split(',');
  const mime = header.match(/data:(.*?);/)?.[1] || record.type;
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const formatBytes = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
