import { useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';

export default function LegalHold({ reviewId, transport }) {
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const apply = async (event) => {
    event.preventDefault();
    if (lock.current || !selection) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try { const result = await transport.legalHold(reviewId, selection === 'hold'); setMessage(result.held ? 'Legal hold applied. Content will be retained.' : 'Legal hold released. Normal retention applies.'); }
    catch (caught) { setError(caught.message || 'Could not update the legal hold.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <form onSubmit={apply} className="space-y-3 border-t pt-4"><label className="block space-y-2"><span className="text-sm font-medium">Review retention</span><NativeSelect value={selection} disabled={busy} onChange={(event) => setSelection(event.target.value)}><NativeSelectOption value="">Choose a legal hold action</NativeSelectOption><NativeSelectOption value="hold">Place legal hold</NativeSelectOption><NativeSelectOption value="release">Release legal hold</NativeSelectOption></NativeSelect></label><p className="text-sm text-muted-foreground">A legal hold protects private content from scheduled deletion. Releasing it permits normal retention processing.</p>{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}<Button variant="outline" disabled={!selection || busy}>{busy ? 'Saving…' : 'Confirm retention change'}</Button></form>;
}
