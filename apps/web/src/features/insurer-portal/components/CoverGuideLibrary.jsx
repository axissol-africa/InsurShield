import { useMemo, useState } from 'react';
import {
  COVER_TYPES, COVER_TYPE_LABELS, blankCoverGuide, cleanCoverGuide,
  coverGuideCompleteness, isCoverGuideComplete, sectionsFor, validateCoverGuide,
} from '@/domain/coverGuide';
import { fieldClass, labelClass } from '@/components/ui/field';
import Badge from '@/components/ui/Badge';
import Meta from '@/components/ui/Meta';
import Progress from '@/components/ui/Progress';
import CoverGuideDocument from '@/components/cover-guide/CoverGuideDocument';

/**
 * Where an insurer states what its cover actually does.
 *
 * Every insurer answers the same questions, so the customer-facing document is
 * identical in shape whoever wrote it — which is the only way a customer can
 * compare two policies without reading both in full. The insurer sees exactly
 * that document in the preview before publishing it.
 *
 * Nothing is published until it is complete: a half-written guide would be
 * worse than none, because it reads as though this insurer simply offers less.
 */
export default function CoverGuideLibrary({ insurer, onSave }) {
  const [coverType, setCoverType] = useState(COVER_TYPES[0]);
  // A published guide is normalised on the way in, not just on the way out:
  // one saved before benefits became plain lines holds `{ item, limit }` pairs,
  // and those would reach a text input as "[object Object]".
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(COVER_TYPES.map((type) => [
      type,
      { ...blankCoverGuide(type), ...cleanCoverGuide(insurer?.coverGuides?.[type] || {}, type) },
    ])));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);

  const draft = drafts[coverType];
  const sections = sectionsFor();
  const progress = coverGuideCompleteness(draft);
  const { errors } = useMemo(() => validateCoverGuide(draft), [draft]);
  const published = insurer?.coverGuides?.[coverType];

  const set = (key, value) => {
    setDrafts((previous) => ({ ...previous, [coverType]: { ...previous[coverType], [key]: value } }));
    setSaved('');
    setError('');
  };

  const publish = async () => {
    const check = validateCoverGuide(draft);
    if (!check.valid) {
      setShowErrors(true);
      setError('Answer the highlighted questions before publishing this guide.');
      return;
    }
    setSaving(coverType);
    setError('');
    try {
      await onSave(coverType, cleanCoverGuide(draft, coverType));
      setShowErrors(false);
      setSaved(coverType);
    } catch (caught) {
      setError(caught.message || 'The cover guide could not be saved.');
    } finally {
      setSaving('');
    }
  };

  return (
    <section className="mx-auto max-w-4xl pb-10">
      <header className="border-b border-line pb-7">
        <Meta className="text-primary">Customer information library</Meta>
        <h2 className="mt-4 text-[30px] font-semibold tracking-[-0.035em] text-ink">Cover guides</h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-[1.6] text-ink-muted">
          Answer these once per cover type. Every insurer on InsurShield answers the same questions,
          so customers compare policies rather than documents — and your plan is read on its terms,
          not on how well it was laid out.
        </p>
      </header>

      {/* Which cover type is being written. */}
      <div role="tablist" aria-label="Cover type" className="no-scrollbar -mb-px mt-7 grid grid-cols-2 border-b border-line">
        {COVER_TYPES.map((type) => {
          const active = coverType === type;
          const done = isCoverGuideComplete({ ...blankCoverGuide(type), ...cleanCoverGuide(insurer?.coverGuides?.[type] || {}, type) });
          return (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => { setCoverType(type); setShowErrors(false); setPreview(false); setError(''); }}
              className={`flex min-h-14 items-center justify-center gap-2.5 border-b-2 px-3 font-mono text-[12px] uppercase tracking-[0.1em] transition-colors duration-200 ease-out ${active ? 'border-primary text-primary' : 'border-transparent text-ink-faint hover:text-ink'}`}
            >
              {COVER_TYPE_LABELS[type]}
              <Badge variant={done ? 'success' : 'warning'}>{done ? 'Published' : 'Needed'}</Badge>
            </button>
          );
        })}
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <Meta className="text-ink-muted">{progress.done} of {progress.total} answered</Meta>
            <Meta className="text-ink-faint">{progress.percent}%</Meta>
          </div>
          <Progress value={progress.percent} className="mt-2 h-1" />
        </div>
        <button
          type="button"
          onClick={() => setPreview((open) => !open)}
          className="inline-flex min-h-11 items-center gap-2 rounded-[1px] border border-dashed border-line-strong px-4 text-[13px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{preview ? 'edit' : 'visibility'}</span>
          {preview ? 'Back to the form' : 'Preview as a customer'}
        </button>
      </div>

      {preview ? (
        <div className="mt-7">
          <p className="mb-4 flex items-start gap-2.5 border border-dashed border-line-strong bg-canvas-2 p-3.5 text-[13px] leading-[1.5] text-ink">
            <span className="material-symbols-outlined shrink-0 text-[18px] text-primary" aria-hidden="true">visibility</span>
            This is the document a customer reads beside every other insurer&apos;s. Anything still
            unanswered shows as “Not stated”.
          </p>
          <CoverGuideDocument guide={draft} coverType={coverType} insurerName={insurer?.name} />
        </div>
      ) : (
        <form
          className="mt-7 space-y-5"
          onSubmit={(event) => { event.preventDefault(); void publish(); }}
        >
          {sections.map((section) => (
            <fieldset key={section.id} className="border border-line bg-white p-5 sm:p-6">
              <legend className="px-2">
                <Meta className="text-ink-muted">{section.title}</Meta>
              </legend>
              <p className="mt-1 text-[12px] leading-[1.5] text-ink-faint">{section.hint}</p>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <Field
                    key={field.key}
                    field={field}
                    value={draft[field.key]}
                    error={showErrors ? errors[field.key] : ''}
                    onChange={(value) => set(field.key, value)}
                  />
                ))}
              </div>
            </fieldset>
          ))}

          {error && (
            <p role="alert" className="flex items-start gap-2.5 border border-primary/30 bg-primary/[0.06] p-3.5 text-[14px] leading-[1.5] text-primary">
              <span className="material-symbols-outlined shrink-0 text-[20px]" aria-hidden="true">error</span>{error}
            </p>
          )}
          {saved === coverType && (
            <p className="flex items-start gap-2.5 border border-dashed border-line-strong bg-canvas-2 p-3.5 text-[14px] leading-[1.5] text-ink">
              <span className="material-symbols-outlined shrink-0 text-[20px] text-primary" aria-hidden="true">task_alt</span>
              Published. Customers comparing {COVER_TYPE_LABELS[coverType].toLowerCase()} quotes see this guide.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={saving === coverType}
              className="inline-flex min-h-12 items-center gap-2 rounded-[1px] bg-primary px-5 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:opacity-60"
            >
              <span className={`material-symbols-outlined text-[18px] ${saving === coverType ? 'animate-spin' : ''}`} aria-hidden="true">{saving === coverType ? 'sync' : 'publish'}</span>
              {saving === coverType ? 'Publishing…' : published ? 'Update the guide' : 'Publish the guide'}
            </button>
            <span className="text-[12px] text-ink-faint">
              {published ? 'Published — changes apply to quotes sent from now on.' : 'Quotes for this cover type cannot be sent until this is published.'}
            </span>
          </div>
        </form>
      )}
    </section>
  );
}

// ── One question ────────────────────────────────────────────────────

function Field({ field, value, error, onChange }) {
  const wide = field.kind === 'long' || field.kind === 'list';
  const describedBy = error ? `${field.key}-error` : undefined;

  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="block">
        <span className={labelClass}>
          {field.label}{field.required && <span className="text-primary"> *</span>}
        </span>

        {field.kind === 'long' && (
          <textarea rows={2} value={value || ''} maxLength={field.max} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} aria-describedby={describedBy} className={`${fieldClass} resize-none`} />
        )}

        {field.kind === 'text' && (
          <input value={value || ''} maxLength={field.max} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} aria-describedby={describedBy} className={fieldClass} />
        )}

        {field.kind === 'days' && (
          <span className="relative block">
            <input inputMode="numeric" value={value ?? ''} onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))} aria-describedby={describedBy} className={`${fieldClass} pr-14`} placeholder="7" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-ink-faint" aria-hidden="true">days</span>
          </span>
        )}

        {field.kind === 'choice' && (
          <select value={value || ''} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} className={fieldClass}>
            <option value="">Choose…</option>
            {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        )}
      </label>

      {field.kind === 'boolean' && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 border border-dashed border-line-strong bg-canvas-2 px-3.5">
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 shrink-0 accent-red-600" />
          <span className="text-[14px] text-ink">Yes</span>
        </label>
      )}

      {field.kind === 'list' && (
        <ListField value={value || []} max={field.max} placeholder={field.placeholder} describedBy={describedBy} onChange={onChange} />
      )}

      {error && (
        <p id={describedBy} role="alert" className="mt-2 text-[12px] leading-[1.4] text-primary">{error}</p>
      )}
    </div>
  );
}

/** A plain list of lines — exclusions, documents needed. */
function ListField({ value, max, placeholder, describedBy, onChange }) {
  const rows = value.length ? value : [''];
  const update = (index, next) => onChange(rows.map((row, position) => (position === index ? next : row)));

  return (
    <div className="space-y-2" aria-describedby={describedBy}>
      {rows.map((row, index) => (
        <div key={index} className="flex gap-2">
          <input value={row} onChange={(event) => update(index, event.target.value)} placeholder={placeholder} className={fieldClass} />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, position) => position !== index))}
            aria-label={`Remove line ${index + 1}`}
            className="inline-flex min-h-11 w-11 shrink-0 items-center justify-center border border-dashed border-line-strong text-ink-faint transition-colors duration-200 ease-out hover:border-primary hover:text-primary"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
          </button>
        </div>
      ))}
      {rows.length < max && (
        <button type="button" onClick={() => onChange([...rows, ''])} className="inline-flex min-h-10 items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>Add another
        </button>
      )}
    </div>
  );
}
