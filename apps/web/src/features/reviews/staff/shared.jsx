import { Button } from '@/components/ui/primitives/button';

export function ResourceState({ resource, children }) {
  if (resource.loading) return <p role="status">Loading…</p>;
  if (resource.error) return <div className="space-y-3"><p role="alert">{resource.error}</p><Button variant="outline" onClick={resource.reload}>Try again</Button></div>;
  return children;
}

export function Pagination({ page, hasMore, onPage }) {
  return <nav aria-label="Review pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!hasMore} onClick={() => onPage(page + 1)}>Next</Button></nav>;
}
