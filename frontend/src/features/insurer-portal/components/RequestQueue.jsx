import { useState } from 'react';
import { formatZMW } from '@/domain/premiumEngine';
import { quoteValidity } from '@/domain/quoteValidity';
import { pageSlice } from '@/features/insurer-portal/portal';
import { Icon, Pagination } from './ui';

const PAGE_SIZE = 4;

/** A paged list of quote requests, either still awaiting this insurer's quote or already quoted. */
export default function RequestQueue({ title, hint, countLabel, requests, emptyMessage, onQuote, onExtend }) {
  const [page, setPage] = useState(1);
  const visible = pageSlice(requests, Math.min(page, Math.max(1, Math.ceil(requests.length / PAGE_SIZE))), PAGE_SIZE);

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-[20px] font-semibold text-on-surface">{title}</h3>
          {hint && <p className="mt-1 text-[13px] text-secondary">{hint}</p>}
        </div>
        <span className="shrink-0 text-[13px] font-semibold text-secondary">{countLabel}</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="divide-y divide-gray-50">
          {visible.length === 0 && <p className="p-8 text-center text-[13px] text-secondary">{emptyMessage}</p>}
          {visible.map((request) => <RequestRow key={request.id} request={request} onQuote={onQuote && (() => onQuote(request))} onExtend={onExtend && (() => onExtend(request))} />)}
        </div>
        <Pagination page={page} total={requests.length} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </section>
  );
}

function RequestRow({ request, onQuote, onExtend }) {
  return (
    <div className="flex flex-col justify-between gap-4 p-4 transition-colors hover:bg-gray-50 md:flex-row md:items-center">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-container-low"><Icon name="directions_car" className="text-primary" /></div>
        <div>
          <p className="text-[16px] font-semibold text-primary">{request.vehicle}</p>
          <p className="text-[12px] text-secondary">ID: {request.id} · {request.value} · {request.usage}</p>
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-4 md:w-auto md:justify-end">
        <span className="text-[12px] text-secondary">{request.time}</span>
        {request.reply ? (
          <QuotedStatus reply={request.reply} onExtend={onExtend} />
        ) : (
          <button type="button" onClick={onQuote} className="flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2 text-[14px] font-semibold text-primary transition-colors hover:bg-primary hover:text-white">
            <Icon name="edit_document" className="text-[18px]" />Send quote
          </button>
        )}
      </div>
    </div>
  );
}

/** A sent quote with its validity window and an extend action while it is still open. */
function QuotedStatus({ reply, onExtend }) {
  const validity = quoteValidity(reply);
  const tone = validity.expired ? 'text-red-700' : validity.expiringSoon ? 'text-amber-800' : 'text-secondary';
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-bold ${validity.expired ? 'bg-slate-200 text-slate-600' : 'bg-primary/5 text-primary'}`}>
        <Icon name={validity.expired ? 'event_busy' : 'task_alt'} className="text-[18px]" />Quoted {formatZMW(reply.premium)}
      </span>
      {validity.validUntil && (
        <span className={`flex items-center gap-2 text-[11px] ${tone}`}>
          {validity.label}
          {!validity.expired && onExtend && <button type="button" onClick={onExtend} className="font-bold text-primary hover:underline">Extend 7 days</button>}
        </span>
      )}
    </div>
  );
}
