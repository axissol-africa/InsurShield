import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { useStore } from '@/store';

export function useReviewAppeals(reviewId, decisionId) {
  const account = useStore((state) => state.customer?.email);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(null);
  const [action, setAction] = useState({ saving: false, error: '' });
  const active = useRef(false);
  const locked = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    active.current = true;
    api.reviewAppeals.list({ signal: controller.signal, params: { reviewId } }).then((appeals) => {
      if (!controller.signal.aborted) setLoaded({ account, reviewId, appeals });
    }).catch((error) => { if (!controller.signal.aborted) setLoaded({ account, reviewId, error: error.message || 'Appeal status could not be loaded.' }); });
    return () => { active.current = false; controller.abort(); };
  }, [account, attempt, reviewId]);
  const current = loaded?.account === account && loaded?.reviewId === reviewId ? loaded : null;
  const submit = async (body) => {
    if (locked.current) return;
    locked.current = true; setAction({ saving: true, error: '' });
    try {
      const appeal = await api.reviewAppeals.submit({ decisionId, ...body });
      if (active.current && useStore.getState().customer?.email === account && !useStore.getState().leaving) setLoaded((value) => ({ account, reviewId, appeals: [...(value?.appeals || []), appeal] }));
    } catch (error) {
      if (active.current && useStore.getState().customer?.email === account) setAction({ saving: false, error: error.message || 'Your appeal could not be submitted. Please try again.' });
    } finally {
      locked.current = false;
      if (active.current) setAction((value) => ({ ...value, saving: false }));
    }
  };
  return { appeals: current?.appeals, error: action.error || current?.error, busy: action.saving, submit, reload: () => { setLoaded(null); setAttempt((value) => value + 1); } };
}
