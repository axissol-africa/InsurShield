import { useState } from 'react';
import { FileText } from 'lucide-react';
import { env } from '@/config/env';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { formatDate } from '@/domain/premiumEngine';
import { INSURER_STATUS_LABELS, statusLabel } from '@/domain/serviceRequests';
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
  const [download, setDownload] = useState(null);
  const open = async (document) => {
    setError('');
    setDownload(null);
    try {
      const url = await openAttachment(document);
      if (url) setDownload({ name: document.name, url });
    } catch (caught) {
      setError(messageOf(caught, 'That document could not be opened.'));
    }
  };
  return (
    <div>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      {download && <p role="status" className="mb-3 text-sm">Your document is ready. <a href={download.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open {download.name}</a></p>}
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
                {update.statusTo && <Badge variant="outline">{staffView ? (INSURER_STATUS_LABELS[update.statusTo] ?? update.statusTo) : statusLabel(update.statusTo)}</Badge>}
                {update.visibleToCustomer === false && <Badge variant="secondary">Internal, not shown to the customer</Badge>}
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">{update.message}</p>
              {update.documents?.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {update.documents.map((document) => (
                    <li key={document.id}>
                      {env.apiMode === 'mock' ? (
                        <span className="inline-flex min-h-9 flex-wrap items-center gap-2 rounded-lg border px-3 text-sm text-muted-foreground">
                          <FileText className="size-4" aria-hidden="true" />{document.name} · Download unavailable in demo
                        </span>
                      ) : (
                        <Button type="button" variant="outline" size="sm" onClick={() => open(document)}>
                          <FileText className="size-4" aria-hidden="true" />{document.name}
                        </Button>
                      )}
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
