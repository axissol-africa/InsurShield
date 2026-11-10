import { useEffect, useState } from 'react';
import { api } from '@/api';
import { Switch } from '@/components/ui/primitives/switch';
import { Label } from '@/components/ui/primitives/label';
import { Card, CardContent } from '@/components/ui/primitives/card';

/**
 * What a customer may and may not switch off.
 *
 * Operational notices are not a choice: they are how somebody learns their
 * payment went through or their claim moved. Showing them anyway, fixed on and
 * labelled, is more honest than hiding them — a preference screen that lists
 * only marketing invites the question of what else is being sent.
 */
const CATEGORIES = [
  { key: 'QUOTE', label: 'Quotes', optional: false },
  { key: 'PAYMENT', label: 'Payments', optional: false },
  { key: 'POLICY', label: 'Policies and certificates', optional: false },
  { key: 'CLAIM', label: 'Claims', optional: false },
  { key: 'NCD', label: 'No-claim discount', optional: false },
  { key: 'INSPECTION', label: 'Inspections', optional: false },
  { key: 'MARKETING', label: 'Product news and offers', optional: true },
];

const CHANNELS = [
  { key: 'IN_APP', label: 'In InsurShield' },
  { key: 'EMAIL', label: 'Email' },
];

/** No saved row means on: only an explicit `false` silences a category. */
const isEnabled = (preferences, category, channel) =>
  preferences.find((row) => row.category === category && row.channel === channel)?.enabled ?? true;

export default function ContactPreferences() {
  const [preferences, setPreferences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const answer = await api.contactPreferences.read();
        if (live) setPreferences(answer.preferences);
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

  async function save(category, channel, enabled) {
    const previous = preferences;
    setSaveFailed(false);
    setPreferences((rows) => [
      ...rows.filter((row) => !(row.category === category && row.channel === channel)),
      { category, channel, enabled },
    ]);
    try {
      await api.contactPreferences.save({ category, channel, enabled });
    } catch {
      // Put the switch back rather than leave it showing a choice that was
      // never saved.
      setPreferences(previous);
      setSaveFailed(true);
    }
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading your preferences…</p>;
  if (failed) return <p className="text-sm text-ink">Your preferences could not be loaded.</p>;

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 py-6">
        <p className="text-sm text-ink-muted">
          Messages about your quotes, payments, policies, claims, no-claim discount and inspections are always sent —
          they are how you find out what has happened. Everything else is your choice.
        </p>

        {saveFailed && <p className="text-sm text-primary">That change was not saved. Try again.</p>}

        <ul className="flex flex-col gap-5">
          {CATEGORIES.map((category) => (
            <li key={category.key} className="flex flex-col gap-3 border-b border-line pb-5 last:border-0 last:pb-0">
              <p className="font-medium text-ink">{category.label}</p>
              <div className="flex flex-wrap gap-6">
                {CHANNELS.map((channel) => {
                  const id = `pref-${category.key}-${channel.key}`;
                  return (
                    <div key={channel.key} className="flex items-center gap-2">
                      <Switch
                        id={id}
                        checked={category.optional ? isEnabled(preferences, category.key, channel.key) : true}
                        disabled={!category.optional}
                        onCheckedChange={(enabled) => void save(category.key, channel.key, enabled)}
                      />
                      <Label htmlFor={id} className="text-sm text-ink-muted">
                        {channel.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
              {!category.optional && (
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">Always sent</p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
