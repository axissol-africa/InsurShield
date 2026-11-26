import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { useStore } from '@/store';

export function usePolicyReview(policyNumber) {
  const account = useStore((state) => state.customer?.email);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(null);
  const [action, setAction] = useState({ saving: false, error: '' });
  const active = useRef(false);
  const locked = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    active.current = true;
    api.reviews.forPolicy(policyNumber, { signal: controller.signal }).then((state) => {
      if (!controller.signal.aborted) setLoaded({ account, policyNumber, state });
    }).catch((error) => {
      if (!controller.signal.aborted) setLoaded({ account, policyNumber, error: error.message || 'Your review could not be loaded.' });
    });
    return () => { active.current = false; controller.abort(); };
  }, [account, policyNumber, attempt]);
  const current = loaded?.account === account && loaded?.policyNumber === policyNumber ? loaded : null;
  const save = async (operation, body) => {
    if (locked.current) return false;
    locked.current = true; setAction({ saving: true, error: '' });
    try {
      const state = await (operation === 'withdraw' ? api.reviews.withdraw(policyNumber) : api.reviews[operation](policyNumber, body));
      if (!active.current || useStore.getState().customer?.email !== account || useStore.getState().leaving) return false;
      setLoaded({ account, policyNumber, state });
      return true;
    } catch (error) {
      if (active.current && useStore.getState().customer?.email === account) setAction({ saving: false, error: error.message || 'Your review could not be saved. Please try again.' });
      return false;
    } finally {
      locked.current = false;
      if (active.current) setAction((value) => ({ ...value, saving: false }));
    }
  };
  return { state: current?.state, error: current?.error, reload: () => { setLoaded(null); setAttempt((value) => value + 1); }, save, saving: action.saving, saveError: action.error, account };
}
