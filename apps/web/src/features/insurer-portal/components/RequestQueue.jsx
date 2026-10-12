import { useState } from 'react';
import { formatZMW } from '@/domain/premiumEngine';
import { quoteValidity } from '@/domain/quoteValidity';
import { pageSlice } from '@/features/insurer-portal/portal';
import Meta from '@/components/ui/Meta';
import { Icon, Pagination } from './ui';

const PAGE_SIZE = 4;

/** A paged list of quote requests, either still awaiting this insurer's quote or already quoted. */
export default function RequestQueue({ title, hint, countLabel, requests, emptyMessage, onQuote, onExtend }) {
  const [page, setPage] = useState(1);
  const visible = pageSlice(requests, Math.min(page, Math.max(1, Math.ceil(requests.length / PAGE_SIZE))), PAGE_SIZE);

  return (
    <section className="mb-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <div className="flex items-center gap-4">
            <Meta className="text-primary">{title}</Meta>
            <span className="h-px w-12 bg-line" aria-hidden="true" />
          </div>
          {hint && <p className="mt-3 max-w-xl text-[13px] leading-[1.55] text-ink-muted">{hint}</p>}
        </div>
        <Meta className="shrink-0 text-ink-faint">{countLabel}</Meta>
      </div>

      <div className="border border-line">
        {visible.length === 0 ? (
          <p className="p-10 text-center text-[13px] text-ink-muted">{emptyMessage}</p>
        ) : (
          visible.map((request, index) => (
            <RequestRow
              key={request.id}
              request={request}
              isFirst={index === 0}
              onQuote={onQuote && (() => onQuote(request))}
              onExtend={onExtend && (() => onExtend(request))}
            />
          ))
        )}
        <Pagination page={page} total={requests.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </section>
  );
}

function RequestRow({ request, isFirst, onQuote, onExtend }) {
  return (
    <div
      className={`group relative flex flex-col justify-between gap-4 p-5 transition-colors duration-200 ease-out hover:bg-canvas-2 md:flex-row md:items-center ${isFirst ? '' : 'border-t border-dashed border-line'}`}
    >
      <span className="beam pointer-events-none absolute left-0 top-0 h-px w-1/4 bg-primary" aria-hidden="true" />

      <div className="flex min-w-0 items-center gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1px] border border-dashed border-line-strong text-primary transition-colors duration-200 ease-out group-hover:border-primary">
          <Icon name="directions_car" className="text-[19px]" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[16px] font-medium tracking-[-0.015em] text-ink">{request.vehicle}</p>
          {/* The reference is the thing an insurer reconciles against, so it
              is set in mono alongside the figures. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Meta className="text-primary">{request.id}</Meta>
            <span className="h-2.5 w-px bg-line-strong" aria-hidden="true" />
            <Meta className="text-ink-faint">{request.value}</Meta>
            <span className="h-2.5 w-px bg-line-strong" aria-hidden="true" />
            <Meta className="text-ink-faint">{request.usage}</Meta>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-between gap-5 md:w-auto md:justify-end">
        <Meta className="shrink-0 text-ink-faint">{request.time}</Meta>
        {request.reply ? (
          <QuotedStatus reply={request.reply} onExtend={onExtend} />
        ) : (
          <button
            type="button"
            onClick={onQuote}
            className="group/btn relative inline-flex min-h-[44px] shrink-0 items-center gap-2.5 overflow-hidden rounded-[1px] bg-primary px-5 text-[14px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Icon name="edit_document" className="relative text-[17px]" />
            <span className="relative">Send quote</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** A sent quote with its validity window and an extend action while it is still open. */
function QuotedStatus({ reply, onExtend }) {
  const validity = quoteValidity(reply);
  return (
    <div className="flex flex-col items-end gap-2">
      <span
        className={`inline-flex items-center gap-2 rounded-[1px] border px-3 py-2 text-[14px] font-medium ${
          validity.expired ? 'border-line-strong text-ink-faint' : 'border-primary/30 bg-primary/[0.06] text-primary'
        }`}
      >
        <Icon name={validity.expired ? 'event_busy' : 'task_alt'} className="text-[17px]" />
        {formatZMW(reply.premium)}
      </span>
      {validity.validUntil && (
        <span className="flex items-center gap-2.5">
          <Meta className={!validity.expired && validity.expiringSoon ? 'text-primary' : 'text-ink-faint'}>
            {validity.label}
          </Meta>
          {!validity.expired && onExtend && (
            <button
              type="button"
              onClick={onExtend}
              className="font-mono text-[11px] uppercase tracking-[0.1em] text-primary underline-offset-4 hover:underline"
            >
              Extend 7 days
            </button>
          )}
        </span>
      )}
    </div>
  );
}
