import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { usePublishedContent } from '../hooks/usePublishedContent';
const labels = { FAQ: 'FAQ', NOTICE: 'Notice', LEGAL: 'Legal information' };
export default function PublishedContent() {
  const { items, loading, failed, retry } = usePublishedContent();
  return (
    <section className="mt-6" aria-label="Published customer information">
      <Card className="gap-0 border-border shadow-none">
        <CardHeader className="border-b">
          <CardTitle>Published customer information</CardTitle>
          <p className="text-sm text-muted-foreground">Approved FAQs, notices and legal information.</p>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {loading && <p role="status" className="text-sm text-muted-foreground">Loading published information…</p>}
          {failed && <div role="alert"><p className="text-sm text-muted-foreground">Published information could not be loaded. Try again.</p><Button variant="outline" size="sm" className="mt-3" onClick={retry}>Try again</Button></div>}
          {!loading && !failed && items.length === 0 && <p className="text-sm text-muted-foreground">There is no additional published information at the moment.</p>}
          {items.map(item => (
            <article key={item.id} className="min-w-0 space-y-2 border-b border-border pb-5 last:border-0 last:pb-0">
              <p className="text-xs text-muted-foreground">{labels[item.type]} · Version {item.version}</p>
              <h3 className="break-words text-base font-semibold text-foreground">{item.title}</h3>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{item.body}</p>
            </article>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
