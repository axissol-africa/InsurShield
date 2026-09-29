/**
 * Step indicator for the quote-to-policy journey.
 * Shown on every step from coverage choice through to payment; pass
 * `JOURNEY_COMPLETE` (see journeySteps.js) on the confirmation screen.
 */
import { JOURNEY_STEPS } from '@/features/quote-journey/journeySteps';
import Meta from '@/components/ui/Meta';

export default function JourneyProgress({ current }) {
  const total = JOURNEY_STEPS.length;
  const activeStep = JOURNEY_STEPS[Math.min(current, total) - 1];
  const completed = current > total;
  const percent = Math.round((Math.min(current, total) / total) * 100);

  return (
    <nav aria-label="Quote journey progress" className="border-b border-line bg-canvas-2">
      {/* Compact mobile variant: a single line plus a bar avoids label collisions on narrow screens. */}
      <div className="px-5 py-4 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Meta className="min-w-0 truncate text-primary">
            {completed ? 'Journey complete' : `Step ${String(current).padStart(2, '0')} · ${activeStep.label}`}
          </Meta>
          {!completed && current < total && (
            <Meta className="shrink-0 text-ink-faint">Next: {JOURNEY_STEPS[current].short}</Meta>
          )}
        </div>
        <div
          className="mt-3 h-[3px] overflow-hidden bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completed ? 100 : percent}
        >
          <div
            className="h-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${completed ? 100 : percent}%` }}
          />
        </div>
      </div>

      <ol className="mx-auto hidden max-w-[1200px] items-center px-6 py-5 md:flex lg:px-10">
        {JOURNEY_STEPS.map((step, index) => {
          const number = index + 1;
          const isComplete = number < current;
          const isActive = number === current;
          const isLast = number === total;
          return (
            <li key={step.label} className={`flex items-center ${isLast ? '' : 'flex-1'}`} aria-current={isActive ? 'step' : undefined}>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[1px] border font-mono text-[11px] leading-none transition-colors duration-200 ease-out ${
                  isComplete
                    ? 'border-primary bg-primary text-white'
                    : isActive
                      ? 'border-primary bg-canvas text-primary'
                      : 'border-line-strong bg-canvas text-ink-faint'
                }`}
              >
                {isComplete ? (
                  <span className="material-symbols-outlined text-[15px]" aria-hidden="true">check</span>
                ) : (
                  String(number).padStart(2, '0')
                )}
                {isComplete && <span className="sr-only">Completed:</span>}
              </span>
              <Meta
                className={`ml-3 whitespace-nowrap ${isActive ? 'text-primary' : isComplete ? 'text-ink' : 'text-ink-faint'}`}
              >
                <span className="xl:hidden">{step.short}</span>
                <span className="hidden xl:inline">{step.label}</span>
              </Meta>
              {/* Dashed ahead, solid once the step is behind you. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={`mx-4 min-w-4 flex-1 border-t ${isComplete ? 'border-primary' : 'border-dashed border-line-strong'}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
