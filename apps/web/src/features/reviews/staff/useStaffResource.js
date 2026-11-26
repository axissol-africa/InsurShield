import { useEffect, useState } from 'react';

export function useStaffResource(load) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ data: null, error: '', loading: true, load: null });
  useEffect(() => {
    let active = true;
    Promise.resolve().then(async () => {
      if (!active) return;
      setState({ data: null, error: '', loading: true, load });
      try {
        const data = await load();
        if (active) setState({ data, error: '', loading: false, load });
      } catch (error) {
        if (active) setState({ data: null, error: error.message || 'Could not load this workspace.', loading: false, load });
      }
    });
    return () => { active = false; };
  }, [load, attempt]);
  // Hide the previous page immediately, before the replacement effect starts.
  return { ...(state.load === load ? state : { data: null, error: '', loading: true }), reload: () => setAttempt((value) => value + 1) };
}
