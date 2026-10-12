import { useRef, useState } from 'react';

const ONLY = 'only';
const without = (key) => (record) => {
  const rest = { ...record };
  delete rest[key];
  return rest;
};

/**
 * One portal action at a time for each record: `pending(key)` while that
 * record's action is in flight, and an `error(key)` the person can act on if
 * it fails. `run(key, …inputs)` resolves to whether the action succeeded, and
 * ignores a second call for a record whose first is still going, so a double
 * click cannot send a quote, extend one or issue a policy twice.
 *
 * A list owns one of these for all its rows, keyed by record: a row that
 * leaves the page and comes back is a new component, and a guard kept in the
 * row would be forgotten with it.
 *
 * The failure message is given by the caller in plain words; what the adapter
 * threw is not shown. A caller whose action throws messages already written
 * for the person passes a function of what was thrown instead.
 */
export function useKeyedPortalAction(action, failureMessage) {
  const inFlight = useRef(new Set());
  const [pending, setPending] = useState({});
  const [errors, setErrors] = useState({});

  const clearError = (key) => setErrors(without(key));

  const run = async (key, ...inputs) => {
    if (inFlight.current.has(key)) return false;
    inFlight.current.add(key);
    setPending((current) => ({ ...current, [key]: true }));
    clearError(key);
    try {
      await action(...inputs);
      return true;
    } catch (caught) {
      const message = typeof failureMessage === 'function' ? failureMessage(caught) : failureMessage;
      setErrors((current) => ({ ...current, [key]: message }));
      return false;
    } finally {
      inFlight.current.delete(key);
      setPending(without(key));
    }
  };

  return { run, pending: (key) => Boolean(pending[key]), error: (key) => errors[key] || '', clearError };
}

/** The same guard for a screen that does one thing: a single `pending` and `error`. */
export function usePortalAction(action, failureMessage) {
  const { run, pending, error, clearError } = useKeyedPortalAction(action, failureMessage);
  return {
    run: (...inputs) => run(ONLY, ...inputs),
    pending: pending(ONLY),
    error: error(ONLY),
    clearError: () => clearError(ONLY),
  };
}
