import { api } from '@/api';
import { MAX_DOCUMENT_BYTES } from '@/lib/files';

export const MAX_FILES = 5;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** What went wrong, in the server's words when it gave some. */
export const messageOf = (caught, fallback) => (typeof caught?.message === 'string' && caught.message.trim() ? caught.message : fallback);

/** Why these files cannot be attached, or null when they can. */
export function filesProblem(files) {
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files.`;
  const wrongType = files.find((file) => !FILE_TYPES.includes(file.type));
  if (wrongType) return `${wrongType.name} is not a PDF, JPG or PNG.`;
  const tooBig = files.find((file) => file.size > MAX_DOCUMENT_BYTES);
  if (tooBig) return `${tooBig.name} is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`;
  return null;
}

/**
 * Opens a document attached to a request. A download link from the API
 * expires within minutes, so a fresh one is asked for at the moment of the
 * click rather than reusing the one the page loaded with. Returns a link for
 * explicit opening when the popup is blocked; never navigates the app away.
 */
export async function openAttachment(document) {
  const opened = window.open('', '_blank');
  try {
    // Keep the handle for navigation, but sever opener access before any await.
    if (opened) opened.opener = null;
    const fresh = await api.documents.get(document.id);
    if (!fresh?.url) throw new Error('This document is not available for download.');
    if (!opened || opened.closed) return fresh.url;
    opened.location.href = fresh.url;
    return null;
  } catch (caught) {
    opened?.close();
    throw caught;
  }
}
