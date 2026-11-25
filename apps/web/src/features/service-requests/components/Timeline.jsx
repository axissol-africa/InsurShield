import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/primitives/badge';
import { formatDate } from '@/domain/premiumEngine';
import { statusLabel } from '@/domain/serviceRequests';
import { messageOf, openAttachment } from '../shared';

const AUTHORS = { CUSTOMER: 'You', INSURER: 'Insurer', SYSTEM: 'InsurShield' };
const time = (at) => `${formatDate(at)}, ${new Date(at).toLocaleTimeString('en-ZM', { hour: '2-digit', minute: '2-digit' })}`;

/**
 * Everything said and done on a request, oldest first. The customer reads
 * "You" and the insurer's name; the insurer reads who wrote each entry and
 * which ones the customer never saw.
 */
export default function Timeline({ updates, insurer, staffView = false }) {
  const [error, setError] = useState('');
  const open = async (document) => {
    setError('');
    try {
      await openAttachment(document);
    } catch (caught) {
      setError(messageOf(caught, 'That document could not be opened.'));
    }
  };
  return (
    <div>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      <ol className="space-y-4" aria-label="What has happened">
        {updates.map((update) => {
          const author = staffView
            ? update.authorName || (update.author === 'CUSTOMER' ? 'Customer' : insurer)
            : update.author === 'INSURER' ? insurer : AUTHORS[update.author];
          return (
            <li key={update.id} className={`rounded-xl border p-4 ${update.visibleToCustomer === false ? 'border-dashed bg-muted/40' : 'bg-card'}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{author}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={update.createdAt}>{time(update.createdAt)}</time>
                {update.statusTo && <Badge variant="outline">{statusLabel(update.statusTo)}</Badge>}
                {update.visibleToCustomer === false && <Badge variant="secondary">Internal, not shown to the customer</Badge>}
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">{update.message}</p>
              {update.documents?.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {update.documents.map((document) => (
                    <li key={document.id}>
                      <button type="button" onClick={() => open(document)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm hover:border-primary hover:text-primary">
                        <FileText className="size-4" aria-hidden="true" />{document.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
