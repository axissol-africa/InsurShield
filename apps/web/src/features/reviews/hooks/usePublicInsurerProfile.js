import { useEffect, useState } from 'react';
import { api } from '@/api';

export function usePublicInsurerProfile(insurerId) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    api.insurerProfiles.public(insurerId, { signal: controller.signal })
      .then((profile) => { if (!controller.signal.aborted) setResult({ insurerId, profile }); })
      .catch((error) => { if (!controller.signal.aborted) setResult(error.status === 404 ? { insurerId, profile: null } : { insurerId, error: error.message || 'The insurer profile could not be loaded.' }); });
    return () => controller.abort();
  }, [insurerId, attempt]);
  return { ...(result?.insurerId === insurerId ? result : { loading: true }), reload: () => { setResult(null); setAttempt((value) => value + 1); } };
}

export function usePublicReviews(insurerId, page) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    api.reviews.publicForInsurer(insurerId, page, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult({ insurerId, page, data }); })
      .catch((error) => { if (!controller.signal.aborted) setResult({ insurerId, page, error: error.message || 'Reviews could not be loaded.' }); });
    return () => controller.abort();
  }, [insurerId, page, attempt]);
  return { ...(result?.insurerId === insurerId && result?.page === page ? result : {}), reload: () => { setResult(null); setAttempt((value) => value + 1); } };
}
