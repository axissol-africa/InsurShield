import { useEffect, useState } from 'react';

// This app does not yet install a server-query library. Keep this read local,
// matching the support flow, until the shared query migration is available.
export function usePublishedContent() {
  const [state, setState] = useState({ items: [], loading: true, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let request = 0;
    const apiModule = import('@/api');
    async function load() {
      const current = ++request;
      setState({ items: [], loading: true, failed: false });
      try {
        const { api } = await apiModule;
        const result = await api.customerContent.published();
        if (!Array.isArray(result?.items)) throw new TypeError('Expected published information items.');
        if (active && current === request) setState({ items: result.items, loading: false, failed: false });
      } catch {
        if (active && current === request) setState({ items: [], loading: false, failed: true });
      }
    }
    load();
    const timer = window.setInterval(load, 60000);
    window.addEventListener('focus', load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', load); };
  }, [attempt]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}
