import { useRef, useState } from 'react';

export function useWorkspaceAction() {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function run(action, { onSuccess, message } = {}) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      onSuccess?.(result);
      if (message) setNotice(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The action could not be completed. Try again.');
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return { run, busy, error, notice };
}
