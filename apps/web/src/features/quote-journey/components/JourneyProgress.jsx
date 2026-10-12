/**
 * Step indicator for the quote-to-policy journey.
 *
 * Shown on every step from coverage choice through to payment; pass
 * `JOURNEY_COMPLETE` (see journeySteps.js) on the confirmation screen.
 *
 * This is the one place the journey says where you are, so the pages beneath
 * it do not repeat the step name in their own headings.
 */
import { JOURNEY_STEPS } from '@/features/quote-journey/journeySteps';
import Meta from '@/components/ui/Meta';
import { cn } from '@/lib/cn';

export default function JourneyProgress({ current }) {
  const total = JOURNEY_STEPS.length;
  const reached = Math.min(current, total);
  const completed = current > total;
  const activeStep = JOURNEY_STEPS[reached - 1];

  return (
    <nav aria-label="Quote journey progress" className="border-b border-line bg-canvas-2">
      {/* A compact, numbered stepper remains visible on phones. Labels live
          below the row so the six markers stay easy to scan and tap-sized. */}
      <div className="px-5 py-4 md:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[14px] font-medium text-ink">
            {completed ? 'Journey complete' : `Step ${reached}: ${activeStep.label}`}
          </span>
          <Meta className="shrink-0 text-ink-faint">
            {completed ? 'Done' : `${reached} / ${total}`}
          </Meta>
        </div>
        <div className="relative mt-4">
          <span aria-hidden="true" className="absolute left-[8.33%] right-[8.33%] top-3.5 h-px bg-line-strong" />
          <span aria-hidden="true" className="absolute left-[8.33%] top-3.5 h-px bg-primary transition-[width] duration-300" style={{ width: completed ? '83.34%' : `${Math.max(0, (reached - 1) * (100 / total))}%` }} />
          <ol className="relative grid grid-cols-6 gap-1" aria-label="Journey steps">
          {JOURNEY_STEPS.map((step, index) => {
            const number = index + 1;
            const isComplete = number < current || completed;
            const isActive = number === current && !completed;
            return (
              <li key={step.label} aria-current={isActive ? 'step' : undefined} className="relative z-10 flex justify-center">
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border bg-canvas text-[11px] font-semibold tabular-nums transition-colors duration-300',
                    isComplete && 'border-primary bg-primary text-white',
                    isActive && 'border-primary bg-canvas text-primary ring-4 ring-primary/15',
                    !isComplete && !isActive && 'border-line-strong text-ink-faint',
                  )}
                >
                  {isComplete ? <span className="material-symbols-outlined text-[15px]" aria-hidden="true">check</span> : number}
                  <span className="sr-only">{isComplete ? `Completed: ${step.label}` : step.label}</span>
                </span>
              </li>
            );
          })}
          </ol>
        </div>
        {!completed && current < total && (
          <Meta className="mt-3 block text-ink-faint">Next · {JOURNEY_STEPS[current].short}</Meta>
        )}
      </div>

      <ol className="mx-auto hidden max-w-[1200px] items-start px-6 py-6 md:flex lg:px-10">
        {JOURNEY_STEPS.map((step, index) => {
          const number = index + 1;
          const isComplete = number < current;
          const isActive = number === current;
          const isLast = number === total;

          return (
            <li
              key={step.label}
              aria-current={isActive ? 'step' : undefined}
              // Equal columns: a connector is `w-full` from one marker's
              // centre, so it lands exactly on the next marker's centre only
              // while every step is the same width. Sizing the last step to
              // its label instead left the line before it overshooting the
              // row — far enough, on a tablet, to scroll the page sideways.
              className="relative flex flex-1 flex-col items-center"
            >
              {/* Runs from this marker's centre to the next one's, behind both. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-1/2 top-[17px] h-px w-full',
                    isComplete ? 'bg-primary' : 'border-t border-dashed border-line-strong',
                  )}
                />
              )}

              <span
                className={cn(
                  'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[13px] font-medium tabular-nums',
                  'transition-colors duration-300 ease-out',
                  isComplete && 'border-primary bg-primary text-white',
                  isActive && 'border-primary bg-canvas text-primary ring-4 ring-primary/15',
                  !isComplete && !isActive && 'border-line-strong bg-canvas text-ink-faint',
                )}
              >
                {isComplete ? (
                  <>
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">check</span>
                    <span className="sr-only">Completed:</span>
                  </>
                ) : (
                  number
                )}
              </span>

              <span
                className={cn(
                  'mt-3 whitespace-nowrap px-2 text-center text-[13px] transition-colors duration-300 ease-out',
                  isActive ? 'font-medium text-primary' : isComplete ? 'text-ink' : 'text-ink-faint',
                )}
              >
                <span className="lg:hidden">{step.short}</span>
                <span className="hidden lg:inline">{step.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
