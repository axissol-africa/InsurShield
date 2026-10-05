import { COVER_TYPE_LABELS, asLines, sectionsFor } from '@/domain/coverGuide';
import Meta from '@/components/ui/Meta';

/**
 * The cover guide as a customer reads it.
 *
 * This is the whole point of the structured form: whichever insurer filled it
 * in, the document has the same sections in the same order, so two policies
 * can be read one after the other without re-learning the layout. The insurer
 * supplies the facts and nothing else — not the order, not the wording of the
 * headings, not which facts are worth mentioning.
 *
 * The same component renders the insurer's preview and the customer's view,
 * so what an insurer approves is exactly what gets published.
 */

/** How one answer is written out, by the kind of question it answered. */
const written = (field, value) => {
  if (field.kind === 'days') return `${value} day${Number(value) === 1 ? '' : 's'}`;
  if (field.kind === 'boolean') return value ? 'Accepted' : 'Not accepted';
  return String(value ?? '').trim() || 'Not stated';
};

export default function CoverGuideDocument({ guide, coverType, insurerName, className = '' }) {
  if (!guide) return null;
  // The plan section is the header; everything else is the body.
  const body = sectionsFor().filter((section) => section.id !== 'plan');

  return (
    <article className={`border border-line bg-white ${className}`}>
      <header className="border-b border-line p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <Meta className="text-primary">{COVER_TYPE_LABELS[coverType]} cover</Meta>
          {insurerName && <Meta className="text-ink-faint">{insurerName}</Meta>}
        </div>
        <h2 className="mt-4 text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[32px]">
          {guide.planName || 'Plan name not stated'}
        </h2>
        {guide.summary && <p className="mt-3 max-w-2xl text-[15px] leading-[1.6] text-ink-muted">{guide.summary}</p>}
      </header>

      <div className="divide-y divide-dashed divide-line">
        {body.map((section) => (
          <section key={section.id} className="p-6 sm:p-8">
            <Meta className="text-ink-muted">{section.title}</Meta>

            {section.id === 'covered' && (
              <ul className="mt-5 space-y-2.5">
                {asLines(guide.coveredItems).map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2.5 text-[15px] leading-[1.45] text-ink">
                    <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-primary" aria-hidden="true">check</span>
                    {benefit}
                  </li>
                ))}
              </ul>
            )}

            {section.id === 'excluded' && (
              <ul className="mt-5 space-y-2.5">
                {asLines(guide.exclusions).map((exclusion) => (
                  <li key={exclusion} className="flex items-start gap-2.5 text-[15px] leading-[1.45] text-ink-muted">
                    <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-ink-faint" aria-hidden="true">close</span>
                    {exclusion}
                  </li>
                ))}
              </ul>
            )}

            {!['covered', 'excluded'].includes(section.id) && (
              <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {section.fields
                  // An optional limit nobody offers is left out rather than
                  // printed as "Not stated", which reads like an oversight.
                  .filter((field) => field.required || field.kind === 'boolean'
                    || (field.kind === 'list' ? asLines(guide[field.key]).length > 0 : String(guide[field.key] ?? '').trim() !== ''))
                  .map((field) => (
                    <div key={field.key} className={field.kind === 'long' || field.kind === 'list' ? 'sm:col-span-2' : ''}>
                      <dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">{field.label}</dt>
                      {/* A list is a list: run together as one line it reads
                          as a single, very long document name. */}
                      {field.kind === 'list' ? (
                        <dd className="mt-2">
                          <ul className="space-y-1.5">
                            {asLines(guide[field.key]).map((line) => (
                              <li key={line} className="flex items-start gap-2.5 text-[15px] leading-[1.45] text-ink">
                                <span className="mt-[9px] h-[3px] w-[3px] shrink-0 rounded-full bg-ink-faint" aria-hidden="true" />
                                {line}
                              </li>
                            ))}
                          </ul>
                        </dd>
                      ) : (
                        <dd className="mt-2 text-[15px] leading-[1.5] text-ink">{written(field, guide[field.key])}</dd>
                      )}
                    </div>
                  ))}
              </dl>
            )}
          </section>
        ))}
      </div>

      <footer className="border-t border-line bg-canvas-2 p-6 text-[12px] leading-[1.6] text-ink-muted sm:px-8">
        Every insurer on InsurShield answers these same questions, so you are comparing like with like.
        The figures above are this insurer&apos;s own and form part of the policy they quote.
      </footer>
    </article>
  );
}
