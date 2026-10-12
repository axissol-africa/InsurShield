import { useRef, useState } from 'react';

/**
 * One portal action at a time: `pending` while it is in flight, and an
 * `error` the person can act on if it fails. `run` resolves to whether the
 * action succeeded, and ignores a second call while the first is still going,
 * so a double click cannot send a quote or issue a policy twice.
 *
 * The failure message is given by the caller in plain words; what the adapter
 * threw is not shown.
 */
export function usePortalAction(action, failureMessage) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const run = async (...inputs) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      await action(...inputs);
      return true;
    } catch {
      setError(failureMessage);
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return { run, pending, error, clearError: () => setError('') };
}
