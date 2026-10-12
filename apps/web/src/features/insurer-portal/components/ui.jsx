/** Small presentational pieces shared by the insurer portal sections. */
import { ArrowLeft, Check, FileImage, FileText, Mail, Phone, Upload, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/files';
import { CASE_STAGES, statusTone } from '@/features/insurer-portal/portal';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/primitives/empty';
import { FieldError } from '@/components/ui/primitives/field';
import {
  Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle,
} from '@/components/ui/primitives/attachment';

/**
 * The top of every portal screen: its name as the page heading, one line on
 * what it is for, and the counts or actions that belong to the whole screen.
 * A screen opened from a section also gets the way back to it.
 */
export function PageHeader({ title, description, onBack, backLabel = 'Back', children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {onBack && <BackButton onClick={onBack} label={backLabel} />}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{children}</div>}
    </div>
  );
}

export function BackButton({ onClick, label = 'Back' }) {
  return (
    <Button type="button" variant="outline" size="icon" onClick={onClick} aria-label={label} className="shrink-0">
      <ArrowLeft aria-hidden="true" />
    </Button>
  );
}

const TONE_BADGES = {
  open: { variant: 'outline', className: 'border-primary/20 bg-primary/10 text-primary' },
  settled: { variant: 'secondary' },
  declined: { variant: 'outline', className: 'text-muted-foreground' },
};

/**
 * A status in words. Open work carries the accent and everything else is
 * neutral, so a queue reads at a glance without relying on colour alone.
 * `tone` sets the weight directly for a label that is not a record status,
 * such as a count in a page header.
 */
export function StatusBadge({ status, tone = statusTone(status), children, className }) {
  const { variant, className: toneClass } = TONE_BADGES[tone];
  return <Badge variant={variant} data-tone={tone} className={cn(toneClass, className)}>{children ?? status}</Badge>;
}

/** A labelled value in a specification grid. Place inside a `<dl>`. `wide` takes the whole row, however many columns the grid has at this width. */
export function Fact({ label, value, wide = false }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-full')}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-snug text-foreground">{value}</dd>
    </div>
  );
}

/** A titled group of facts, so a long record reads as a few subjects rather than one list. */
export function FactGroup({ title, columns = 2, children }) {
  return (
    <section>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <dl className={cn('mt-3 grid grid-cols-1 gap-x-6 gap-y-4', columns === 2 && 'sm:grid-cols-2')}>{children}</dl>
    </section>
  );
}

/** The customer's phone and email as links, so reaching them is one tap from wherever their name appears. */
export function ContactLinks({ phone, email, className }) {
  if (!phone && !email) return null;
  const link = 'inline-flex min-w-0 items-center gap-1.5 text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';
  return (
    <span className={cn('flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm', className)}>
      {phone && <a href={`tel:${phone}`} className={link}><Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{phone}</a>}
      {email && <a href={`mailto:${email}`} className={link}><Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="break-all">{email}</span></a>}
    </span>
  );
}

const STEP_MARKERS = {
  done: 'bg-foreground text-background',
  current: 'bg-primary text-primary-foreground ring-4 ring-primary/15',
  next: 'border border-border bg-background text-muted-foreground',
};
const STEP_COLUMNS = { 3: 'grid-cols-3', 4: 'grid-cols-4' };
const STEP_STATES_IN_WORDS = { done: 'Done: ', next: 'Next: ' };

/**
 * A short process laid out in order. Each step is `done`, `current` or
 * `next`, said in words as well as shown, with an optional note such as when
 * it happened or whose step it is. `label` names the process.
 */
export function StepTrack({ label, steps }) {
  return (
    <ol aria-label={label} className={cn('grid', STEP_COLUMNS[steps.length])}>
      {steps.map((step, index) => (
        <li key={step.id} aria-current={step.state === 'current' ? 'step' : undefined} className="min-w-0">
          <div className="flex items-center" aria-hidden="true">
            <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums', STEP_MARKERS[step.state])}>
              {step.state === 'done' ? <Check className="size-3.5" /> : index + 1}
            </span>
            {index < steps.length - 1 && <span className={cn('mx-2 h-px flex-1', step.state === 'done' ? 'bg-foreground/50' : 'bg-border')} />}
          </div>
          <p className={cn('mt-2 pr-2 text-xs font-medium leading-snug sm:text-sm', step.state === 'next' && 'text-muted-foreground')}>
            {STEP_STATES_IN_WORDS[step.state] && <span className="sr-only">{STEP_STATES_IN_WORDS[step.state]}</span>}
            {step.label}
          </p>
          {step.note && <p className={cn('mt-0.5 pr-2 text-xs', step.state === 'current' ? 'font-medium text-primary' : 'text-muted-foreground')}>{step.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Where one policy sale stands: request, quote, payment, certificate. The
 * quote and certificate screens both show it, so each reads as a step in the
 * same case and says plainly when the step is the insurer's. `current` is a
 * stage id; `notes` adds a short line under a stage, such as when it happened.
 */
export function CaseProgress({ current, notes = {} }) {
  const currentIndex = CASE_STAGES.findIndex((stage) => stage.id === current);
  const steps = CASE_STAGES.map((stage, index) => {
    if (index < currentIndex) return { id: stage.id, label: stage.done, state: 'done', note: notes[stage.id] };
    if (index === currentIndex) return { id: stage.id, label: stage.todo, state: 'current', note: 'Your step' };
    return { id: stage.id, label: stage.todo, state: 'next', note: notes[stage.id] };
  });
  return <StepTrack label="Where this policy stands" steps={steps} />;
}

/** What a list looks like before anything is in it: what will appear, and one action when there is something to do. */
export function EmptyPanel({ icon: PanelIcon, title, description, children, className }) {
  return (
    <Empty className={cn('border', className)}>
      <EmptyHeader>
        {PanelIcon && <EmptyMedia variant="icon"><PanelIcon aria-hidden="true" /></EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}

/**
 * File picker and preview for a PDF/JPG/PNG document record produced by
 * `documentToRecord`. `id` labels the file input, so a `<label htmlFor>` or
 * `FieldLabel` can name it; `inputRef` lets a form move focus to it.
 */
export function DocumentPicker({ id, inputRef, document, onPick, onClear, prompt, error }) {
  const errorId = id ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-2">
      {document ? (
        <Attachment className="w-full">
          <AttachmentMedia>
            {document.type === 'application/pdf' ? <FileText aria-hidden="true" /> : <FileImage aria-hidden="true" />}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{document.name}</AttachmentTitle>
            <AttachmentDescription>{formatBytes(document.size)}</AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction type="button" size="icon-sm" aria-label={`Remove ${document.name}`} onClick={onClear}>
              <X aria-hidden="true" />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ) : (
        <label
          className={cn(
            'flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-input bg-input/30 p-4 transition-colors hover:bg-input/50 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
            error && 'border-destructive',
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <Upload className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 text-sm">
            <span className="block font-medium text-foreground">{prompt}</span>
            <span className="text-muted-foreground">PDF, JPG or PNG up to 3 MB</span>
          </span>
          <input
            id={id}
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="sr-only"
            onChange={onPick}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}
