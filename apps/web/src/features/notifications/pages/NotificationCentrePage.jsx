import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api } from '@/api';
import Meta from '@/components/ui/Meta';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { formatDate } from '@/domain/premiumEngine';

/** Where a message about this kind of record takes the reader. */
const DESTINATION = {
  QUOTE_REQUEST: '/quotes-comparison',
  PAYMENT: '/account',
  POLICY: '/account',
  CLAIM: '/account',
  NCD_APPLICATION: '/account',
  INSPECTION: '/account',
};

export default function NotificationCentrePage() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (before) => {
    // Nothing is set before the first await: setting state synchronously inside
    // an effect cascades renders, which is what the lint rule objects to.
    try {
      const page = await api.notifications.list(before);
      setFailed(false);
      setItems((existing) => (before ? [...existing, ...page.items] : page.items));
      setUnread(page.unread);
      // A short page is the end: asking again would return the same nothing.
      setCursor(page.items.length > 0 ? page.nextCursor : null);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The effect owns its own async work and touches state only after the
    // request settles. Calling a prepared callback here reads to the lint rule
    // as a synchronous state change, which cascades renders.
    let live = true;
    void (async () => {
      try {
        const page = await api.notifications.list();
        if (!live) return;
        setItems(page.items);
        setUnread(page.unread);
        setCursor(page.items.length > 0 ? page.nextCursor : null);
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function markRead(id) {
    // Shown as read at once; the server is the authority but the reader should
    // not wait on a round trip to see their own tap register.
    setItems((existing) => existing.map((item) => (item.id === id ? { ...item, read: true } : item)));
    setUnread((count) => Math.max(0, count - 1));
    try {
      await api.notifications.markRead(id);
    } catch {
      await load();
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <Meta title="Notifications" description="Everything InsurShield has told you about your quotes, policies and claims." />

      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted">Your updates</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Notifications</h1>
        </div>
        {unread > 0 && <Badge aria-label={`${unread} unread`}>{unread} unread</Badge>}
      </header>

      {loading && <p className="text-sm text-ink-muted">Loading your notifications…</p>}

      {failed && !loading && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-6">
            <p className="text-sm text-ink">Your notifications could not be loaded.</p>
            <Button type="button" variant="outline" className="self-start" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !failed && items.length === 0 && (
        <EmptyState
          icon="email"
          title="Nothing yet"
          hint="When an insurer quotes, a payment goes through or a claim moves, you will find it here."
        />
      )}

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <Card className={item.read ? 'opacity-70' : undefined}>
              <CardContent className="flex flex-col gap-2 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-ink">{item.subject}</p>
                    <p className="mt-1 text-sm text-ink-muted">{item.body}</p>
                  </div>
                  {!item.read && <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <time className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted" dateTime={item.createdAt}>
                    {formatDate(new Date(item.createdAt))}
                  </time>
                  {DESTINATION[item.entityType] && (
                    <Link to={DESTINATION[item.entityType]} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                      Open
                    </Link>
                  )}
                  {!item.read && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void markRead(item.id)}>
                      <Check aria-hidden className="mr-1 h-4 w-4" />
                      Mark read
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {cursor && (
        <Button type="button" variant="outline" className="mt-6" onClick={() => void load(cursor)}>
          Load older
        </Button>
      )}
    </div>
  );
}
