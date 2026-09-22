import { useState } from 'react';
import { documentToRecord } from '@/lib/files';

/**
 * State for a single uploaded document (quotation, certificate…): the stored
 * record, a validation error, and handlers for a file input.
 */
export function useDocumentUpload() {
  const [document, setDocument] = useState(null);
  const [error, setError] = useState('');

  const pick = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      setDocument(await documentToRecord(file));
    } catch (caught) {
      setError(caught.message);
    } finally {
      event.target.value = '';
    }
  };

  const clear = () => setDocument(null);

  return { document, error, setError, pick, clear };
}
