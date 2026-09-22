/**
 * Step indicator for the quote-to-policy journey.
 * Shown on every step from coverage choice through to payment; pass
 * `JOURNEY_COMPLETE` (see journeySteps.js) on the confirmation screen.
 */
import { JOURNEY_STEPS } from '@/features/quote-journey/journeySteps';

export default function JourneyProgress({ current }) {
  const total = JOURNEY_STEPS.length;
  const activeStep = JOURNEY_STEPS[Math.min(current, total) - 1];
  const completed = current > total;
  const percent = Math.round((Math.min(current, total) / total) * 100);

  return (
    <nav aria-label="Quote journey progress" className="border-b border-slate-200 bg-slate-50">
      {/* Compact mobile variant: a single line plus a bar avoids label collisions on narrow screens. */}
      <div className="px-5 py-4 md:hidden">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-bold text-primary">{completed ? 'Journey complete' : `Step ${current} of ${total} · ${activeStep.label}`}</span>
          {!completed && current < total && <span className="text-secondary">Next: {JOURNEY_STEPS[current].short}</span>}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completed ? 100 : percent}>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${completed ? 100 : percent}%` }} />
        </div>
      </div>

      <ol className="mx-auto hidden max-w-6xl items-center px-8 py-5 md:flex">
        {JOURNEY_STEPS.map((step, index) => {
          const number = index + 1;
          const isComplete = number < current;
          const isActive = number === current;
          const isLast = number === total;
          return (
            <li key={step.label} className={`flex items-center ${isLast ? '' : 'flex-1'}`} aria-current={isActive ? 'step' : undefined}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[15px] font-bold ${isComplete || isActive ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-secondary'}`}>
                {isComplete ? <span className="material-symbols-outlined text-[18px]" aria-hidden="true">check</span> : number}
                {isComplete && <span className="sr-only">Completed:</span>}
              </span>
              <span className={`ml-2 whitespace-nowrap text-[14px] ${isActive ? 'font-bold text-primary' : isComplete ? 'font-semibold text-on-surface' : 'font-medium text-secondary'}`}>
                <span className="xl:hidden">{step.short}</span>
                <span className="hidden xl:inline">{step.label}</span>
              </span>
              {!isLast && <span aria-hidden="true" className={`mx-3 h-0.5 min-w-4 flex-1 ${isComplete ? 'bg-primary' : 'bg-slate-200'}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
