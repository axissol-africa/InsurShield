import { Button } from '@/components/ui/primitives/button';

export function WorkspaceState({ loading, error, reload, children }) {
  if (loading) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-destructive">{error}</p>
      <Button type="button" variant="outline" onClick={reload}>Retry</Button>
    </div>
  );
  return children;
}

export function WorkspaceFeedback({ error, notice }) {
  return (
    <>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    </>
  );
}

export function WorkspaceField({ label, children }) {
  return <label className="grid min-w-0 gap-2 text-sm font-medium"><span>{label}</span>{children}</label>;
}

export function WorkspacePages({ page, hasMore, onPage }) {
  return (
    <nav aria-label="Result pages" className="flex items-center justify-between gap-2">
      <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="text-sm text-muted-foreground">Page {page}</span>
      <Button type="button" variant="outline" size="sm" disabled={!hasMore} onClick={() => onPage(page + 1)}>Next</Button>
    </nav>
  );
}
