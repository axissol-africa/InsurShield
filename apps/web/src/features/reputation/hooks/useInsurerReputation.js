import { useEffect, useState } from 'react';
import { api } from '@/api';
import { env } from '@/config/env';

// Suspension checks are bounded to one minute while the page is visible.
const refreshIntervalMs = 60_000;
const maxTimeoutMs = 2_147_483_647;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useInsurerReputation(insurerIds) {
  const key = JSON.stringify([...new Set(insurerIds.filter((id) => typeof id === 'string' && uuid.test(id)).map((id) => id.toLowerCase()))].sort());
  const enabled = env.apiMode === 'http' && key !== '[]';
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${attempt}:${key}`;
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const ids = JSON.parse(key);
    const batches = [];
    for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
    let inFlight = false;
    let items = [];
    let expiryTimer;
    let refreshTimer;

    const publish = () => {
      clearTimeout(expiryTimer);
      const now = Date.now();
      items = items.map((item) => ({
        ...item,
        badges: item.badges.filter((badge) => Date.parse(badge.expiresAt) > now),
      }));
      setResult({ requestKey, items });
      const deadlines = items.flatMap((item) => item.badges.map((badge) => Date.parse(badge.expiresAt)));
      if (deadlines.length) {
        const nextExpiry = Math.min(...deadlines);
        // Long-lived awards must not overflow the browser's signed 32-bit timeout.
        expiryTimer = setTimeout(publish, Math.min(nextExpiry - now, maxTimeoutMs));
      }
    };

    const load = async () => {
      if (inFlight || controller.signal.aborted || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        // Wait for every batch, even on failure, so a refresh cannot overlap a slow batch.
        const responses = await Promise.allSettled(batches.map((batch) => api.insurerReputation.list(batch, { signal: controller.signal })));
        if (controller.signal.aborted) return;
        if (responses.some((response) => response.status === 'rejected')) throw new Error('Reputation unavailable');
        items = responses.flatMap((response) => response.value.items);
        publish();
      } catch {
        if (!controller.signal.aborted) {
          clearTimeout(expiryTimer);
          items = [];
          setResult({ requestKey, items, error: true });
        }
      } finally {
        inFlight = false;
      }
    };
    const resume = () => {
      clearInterval(refreshTimer);
      if (document.visibilityState !== 'visible') return;
      // Recheck deadlines after browser sleep/throttling, even if a request is still pending.
      if (items.length) publish();
      void load();
      refreshTimer = setInterval(load, refreshIntervalMs);
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    resume();
    return () => {
      controller.abort();
      clearTimeout(expiryTimer);
      clearInterval(refreshTimer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, [enabled, key, requestKey]);
  if (!enabled) return { items: [], loading: false };
  const reload = () => setAttempt((previous) => previous + 1);
  return result?.requestKey === requestKey ? { ...result, reload } : { items: [], loading: true };
}
