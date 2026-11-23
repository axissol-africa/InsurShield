import { formatZMW } from '@/domain/premiumEngine';
import { quoteValidity } from '@/domain/quoteValidity';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/primitives/card';
import { DataTable } from '@/components/ui/data-table';
import { useKeyedPortalAction } from '@/features/insurer-portal/hooks/usePortalAction';
import { EXTENSION_DAYS, days, replyDeadline } from '@/features/insurer-portal/portal';

const PAGE_SIZE = 4;
/** A chosen product is its own row; a request from before product selection is keyed by its id. */
const rowKey = (request) => request.caseKey ?? request.id;

export default function RequestQueue({ title, hint, countLabel, requests, emptyMessage, onQuote, onExtend }) {
  // Held by the queue, not the row: paging away and back makes a new row, and
  // an extension still in flight must not be offered a second time.
  const extending = useKeyedPortalAction(onExtend, 'Could not extend this quote. Please try again.');
  const quoteCell = (request, className) => request.reply ? (
    <QuotedStatus
      reply={request.reply}
      onExtend={onExtend && (() => extending.run(rowKey(request), request))}
      extending={extending.pending(rowKey(request))}
      error={extending.error(rowKey(request))}
    />
  ) : (
    <Button type="button" onClick={onQuote && (() => onQuote(request))} className={className}>Send quote</Button>
  );

  const columns = [
    {
      accessorKey: 'vehicle',
      header: 'Vehicle / reference',
      cell: ({ row }) => (
        <div className="min-w-40 max-w-60 whitespace-normal">
          <p className="font-medium text-foreground">{row.original.vehicle}</p>
          <ProductLine request={row.original} />
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{row.original.id}</p>
        </div>
      ),
    },
    {
      accessorKey: 'vehicleValue',
      header: 'Cover / value',
      cell: ({ row }) => (
        <div className="min-w-36 max-w-56 whitespace-normal">
          <p className="font-medium">{row.original.coverage}</p>
          <p className="mt-1 text-muted-foreground"><span className="tabular-nums">{row.original.value}</span> · {row.original.usage}</p>
        </div>
      ),
    },
    {
      accessorKey: 'submittedAt',
      header: 'Received',
      cell: ({ row }) => (
        <div className="space-y-1">
          <span className="text-muted-foreground">{row.original.time}</span>
          <ReplyBy request={row.original} />
        </div>
      ),
    },
    {
      id: 'quote',
      header: 'Quote',
      cell: ({ row }) => quoteCell(row.original),
    },
  ];

  return (
    <Card className="mb-6 min-w-0 gap-0 py-0">
      <CardHeader className="gap-2 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle><h2>{title}</h2></CardTitle>
          <Badge variant="secondary">{countLabel}</Badge>
        </div>
        {hint && <CardDescription className="max-w-2xl leading-relaxed">{hint}</CardDescription>}
      </CardHeader>
      <CardContent className="min-w-0 px-0">
        <DataTable
          columns={columns}
          data={requests}
          // Two products chosen from one insurer share a request id; each is its own row.
          getRowId={rowKey}
          label={title}
          emptyMessage={emptyMessage}
          pageSize={PAGE_SIZE}
          renderCard={(request) => (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{request.vehicle}</p>
                  <ProductLine request={request} />
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{request.id}</p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">{request.time}</span>
              </div>
              <p className="text-sm">
                <span className="font-medium">{request.coverage}</span>
                <span className="text-muted-foreground"> · <span className="tabular-nums">{request.value}</span> · {request.usage}</span>
              </p>
              <ReplyBy request={request} />
              {quoteCell(request, 'w-full')}
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}

/** The product the customer chose, when the request names one. */
export function ProductLine({ request }) {
  if (!request.productName) return null;
  const version = request.productVersionNumber ? ` · version ${request.productVersionNumber}` : '';
  return <p className="mt-1 text-sm text-foreground">{request.productName}<span className="text-muted-foreground">{version}</span></p>;
}

/** While a request still needs a reply, how long is left to send one. */
function ReplyBy({ request }) {
  const deadline = request.reply ? null : replyDeadline(request);
  if (!deadline) return null;
  return <span className={`block text-xs ${deadline.urgent ? 'font-medium text-primary' : 'text-muted-foreground'}`}>{deadline.label}</span>;
}

function QuotedStatus({ reply, onExtend, extending, error }) {
  const validity = quoteValidity(reply);

  return (
    <div className="flex min-w-32 max-w-48 flex-col items-start gap-1 whitespace-normal">
      <p className="font-medium tabular-nums">{formatZMW(reply.premium)}</p>
      {validity.validUntil && <p className={`text-xs ${validity.expired || validity.expiringSoon ? 'text-primary' : 'text-muted-foreground'}`}>{validity.label}</p>}
      {validity.validUntil && !validity.expired && onExtend && (
        <Button type="button" variant="link" size="sm" onClick={onExtend} disabled={extending} aria-busy={extending} className="h-8 px-0">
          {extending ? 'Extending…' : `Extend ${days(EXTENSION_DAYS)}`}
        </Button>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
