import { cn } from '@/lib/cn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { CaseProgress, PageHeader } from './ui';

/**
 * A screen where the insurer hands one thing back to a customer: a quotation,
 * a certificate. Every such screen is laid out the same way, so the officer
 * always finds the same things in the same place:
 *
 *   1. what this is and how long the customer has waited   (the header and `status`)
 *   2. where the policy stands and whose turn it is        (`stage`)
 *   3. what the customer gave                              (`reference`, a `TaskPanel`)
 *   4. what the insurer hands back                         (`children`, a `TaskPanel` holding the form)
 *
 * The form ends with a `TaskOutcome` saying what the customer gets, directly
 * above the one action that sends it.
 */
export function TaskScreen({ title, description, onBack, backLabel, status, stage, stageNotes, reference, children }) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} onBack={onBack} backLabel={backLabel}>{status}</PageHeader>
      <Card size="sm">
        <CardContent><CaseProgress current={stage} notes={stageNotes} /></CardContent>
      </Card>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 lg:sticky lg:top-22">{reference}</div>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

/** One side of a task screen. It is a named region, so it can be reached and tested by what it holds. */
export function TaskPanel({ title, description, children }) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle><h2>{title}</h2></CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * The consequence of the action below it, in the customer's terms: what they
 * will see, or what happens next. Read last, just before committing.
 */
export function TaskOutcome({ title, children, className }) {
  return (
    <section aria-label={title} className={cn('rounded-2xl border border-border bg-muted/40 p-4', className)}>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}
