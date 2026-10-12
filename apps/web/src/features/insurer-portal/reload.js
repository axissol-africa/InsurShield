import { hydrateInsurerPortal } from '@/api/sync';

/**
 * Make a change, then reload the portal whether or not it went through. A
 * request can fail after the server has acted on it, or because a colleague
 * got there first; either way the lists must show what is true now rather
 * than what this browser last saw, or the same thing is offered again.
 */
export const thenReloadPortal = async (change) => {
  try {
    return await change();
  } finally {
    await hydrateInsurerPortal();
  }
};
