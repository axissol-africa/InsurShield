import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { useStore, belongsToCustomer } from '@/store';
import { requestStatus } from '@/domain/quoteValidity';
import { renewalState } from '@/domain/renewal';
import { statusLabel, typeLabel } from '@/domain/serviceRequests';
import { formatDate } from '@/domain/premiumEngine';
import { openDocument, formatBytes } from '@/lib/files';
import { openAttachment } from '@/features/service-requests/shared';
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext } from '@/components/ui/primitives/pagination';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select';

const KINDS = { quotes: 'Quote requests', policies: 'Policies', renewals: 'Renewals', 'service-requests': 'Service requests', documents: 'Documents' };
const START = { quotes: ['/insurance-type', 'Start a quote'], policies: ['/insurance-type', 'Find cover'], renewals: ['/renewal', 'Review renewal options'], 'service-requests': ['/service-requests/new', 'Request a change'], documents: ['/account?section=policies', 'View policy documents'] };
const date = (value) => value ? formatDate(value) : 'Not recorded';

export default function AccountPortfolio({ section = 'overview', onOpenRequest }) {
  const { customer, policies, quoteRequests } = useStore();
  const identity = customer?.email || '';
  const [page, setPage] = useState(1);
  const [remoteState, setRemoteState] = useState({ documents: [], services: [], loading: true, errors: [] });
  const remote = remoteState.identity === identity ? remoteState : { documents: [], services: [], loading: true, errors: [] };
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState(section === 'overview' ? 'all' : section);
  const [status, setStatus] = useState('all');
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState('');
  const [fallback, setFallback] = useState(null);
  useEffect(() => {
    let current = true;
    Promise.allSettled([api.account.documents(), api.serviceRequests.listMine()]).then(([documents, services]) => {
      if (!current) return;
      setRemoteState({ identity, documents: documents.status === 'fulfilled' ? documents.value : [], services: services.status === 'fulfilled' ? services.value : [], loading: false,
        errors: [documents.status === 'rejected' && 'Documents could not be loaded.', services.status === 'rejected' && 'Service requests could not be loaded.'].filter(Boolean) });
    });
    return () => { current = false; };
  }, [attempt, identity]);
  const own = belongsToCustomer(customer);
  const ownedPolicies = policies.filter(own);
  const rows = [
    ...quoteRequests.filter(own).map((record) => ({ kind: 'quotes', id: record.id, title: record.vehicle || record.id, insurer: record.insurers?.join(', ') || 'Insurers not selected', status: requestStatus(record).status, updatedAt: record.updatedAt || record.quotesRequestedAt || record.submittedAt, due: record.expiresAt, action: 'Review quotes', request: record })),
    ...ownedPolicies.map((record) => ({ kind: 'policies', id: record.policyNumber, title: record.vehicle || record.policyNumber, insurer: record.insurer, status: record.status, updatedAt: record.updatedAt || record.issuedAt || record.receivedAt, due: record.policyDates?.endDate, action: 'View policy', href: ['Awaiting insurer certificate', 'Issuance failed'].includes(record.status) || (record.status === 'Cancelled' && record.issuance?.failedAt) ? '/account?section=certificates' : '/account?section=policies' })),
    ...ownedPolicies.filter((record) => ['Active', 'Expired'].includes(record.status)).map((record) => {
      const renewal = renewalState(record);
      return { kind: 'renewals', id: record.policyNumber, title: record.vehicle || record.policyNumber, insurer: record.insurer, status: !renewal.renewable ? 'Renewal in progress' : { DUE: 'Due for renewal', EXPIRED: 'Cover ended', NOT_DUE: 'Not due yet' }[renewal.window], updatedAt: record.updatedAt || record.issuedAt, due: renewal.endDate, action: 'Review renewal', href: '/renewal' };
    }),
    ...remote.services.map((record) => ({ kind: 'service-requests', id: record.reference, title: typeLabel(record.type), insurer: record.insurer, status: statusLabel(record.status), updatedAt: record.updatedAt || record.createdAt, due: record.requestedEffectiveDate, action: record.nextAction === 'REPLY' ? 'Reply to insurer' : 'View timeline', href: `/service-requests/${encodeURIComponent(record.reference)}` })),
    ...remote.documents.map((record) => ({ kind: 'documents', id: record.id, title: record.name, insurer: record.kind.replaceAll('_', ' '), status: record.available ? 'Available' : 'Unavailable', updatedAt: record.uploadedAt, action: 'Open document', document: record })),
  ];
  const inKind = rows.filter((row) => kind === 'all' || row.kind === kind);
  const statuses = [...new Set(inKind.map((row) => row.status))].filter(Boolean).sort();
  const needle = search.trim().toLowerCase();
  const filtered = inKind.filter((row) => (status === 'all' || row.status === status) && `${row.id} ${row.title} ${row.insurer} ${row.status}`.toLowerCase().includes(needle));
  filtered.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  const pages = Math.max(1, Math.ceil(filtered.length / 5));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 5, currentPage * 5);
  const open = async (document) => {
    if (opening) return;
    setOpening(document.id); setError(''); setFallback(null);
    try {
      if (document.dataUrl) openDocument(document);
      else {
        const url = await openAttachment(document);
        if (url) setFallback({ name: document.name, url });
      }
    } catch (caught) { setError(caught.message || 'The document could not be opened. Please try again.'); }
    finally { setOpening(null); }
  };
  return <Card className="mt-6 shadow-none">
    <CardHeader><CardTitle>Your portfolio</CardTitle><p className="text-sm text-muted-foreground">Search by reference, vehicle, insurer or document name.</p></CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <div className="min-w-0 flex-1"><label htmlFor="portfolio-search" className="mb-1 block text-sm">Search portfolio</label><Input id="portfolio-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
        {section === 'overview' && <div><p id="portfolio-kind-label" className="mb-1 text-sm">Record type</p><Select value={kind} onValueChange={(value) => { setKind(value); setStatus('all'); setPage(1); }}><SelectTrigger aria-labelledby="portfolio-kind-label"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All records</SelectItem>{Object.entries(KINDS).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select></div>}
        <div><p id="portfolio-status-label" className="mb-1 text-sm">Status</p><Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger aria-labelledby="portfolio-status-label"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{statuses.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
      </div>
      {remote.loading && <p role="status">Loading documents and service requests…</p>}
      {remote.errors.length > 0 && <div role="alert"><p>{remote.errors.join(' ')} Other available records are shown below.</p><Button variant="outline" onClick={() => { setRemoteState((value) => ({ ...value, loading: true, errors: [] })); setAttempt((value) => value + 1); }}>Retry loading</Button></div>}
      {error && <p role="alert">{error}</p>}
      {fallback && <p role="status">Document ready. <a href={fallback.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open {fallback.name}</a></p>}
      <p role="status" className="text-sm text-muted-foreground">{filtered.length} matching record{filtered.length === 1 ? '' : 's'}</p>
      {filtered.length > 0 && <ul className="divide-y rounded-xl border">{visible.map((row) => <li key={`${row.kind}-${row.id}`} className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words font-medium">{row.title}</p><p className="break-words text-sm text-muted-foreground">{KINDS[row.kind]} · {row.id} · {row.insurer}</p></div><Badge variant="outline">{row.status}</Badge></div>
        <p className="text-sm text-muted-foreground">Latest update: {date(row.updatedAt)} · {row.kind === 'documents' ? `${formatBytes(row.document.size)} · No due date` : `Due: ${row.due ? date(row.due) : 'No date set'}`}</p>
        {row.document ? <Button variant="outline" disabled={!row.document.available || Boolean(opening)} onClick={() => open(row.document)}>{opening === row.id ? 'Opening…' : row.document.available ? row.action : 'Download unavailable'}</Button>
          : row.request ? <Button variant="outline" onClick={() => onOpenRequest(row.request)}>{row.action}</Button>
            : <Button variant="outline" asChild><Link to={row.href}>{row.action}</Link></Button>}
      </li>)}</ul>}
      {pages > 1 && <Pagination aria-label="Portfolio pages"><PaginationContent>
        <PaginationItem><PaginationPrevious href="#portfolio-search" aria-disabled={currentPage === 1} tabIndex={currentPage === 1 ? -1 : undefined} onClick={(event) => { event.preventDefault(); if (currentPage > 1) setPage(currentPage - 1); }} /></PaginationItem>
        <PaginationItem><span className="px-2 text-sm" role="status">Page {currentPage} of {pages}</span></PaginationItem>
        <PaginationItem><PaginationNext href="#portfolio-search" aria-disabled={currentPage === pages} tabIndex={currentPage === pages ? -1 : undefined} onClick={(event) => { event.preventDefault(); if (currentPage < pages) setPage(currentPage + 1); }} /></PaginationItem>
      </PaginationContent></Pagination>}
      {!filtered.length && !remote.loading && <div className="rounded-xl border border-dashed p-4"><p>{search || status !== 'all' ? 'No records match these filters.' : 'No records here yet.'}</p>{(search || status !== 'all') && <Button variant="ghost" onClick={() => { setSearch(''); setStatus('all'); setPage(1); }}>Clear filters</Button>}</div>}
      {!remote.loading && !search && status === 'all' && Object.entries(KINDS).filter(([id]) => (kind === 'all' || kind === id) && !rows.some((row) => row.kind === id) && !(remote.errors.length && ['documents', 'service-requests'].includes(id))).map(([id, label]) => <div key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4"><p className="text-sm">No {label.toLowerCase()} yet.</p><Button asChild variant="outline"><Link to={START[id][0]}>{START[id][1]}</Link></Button></div>)}
    </CardContent>
  </Card>;
}
