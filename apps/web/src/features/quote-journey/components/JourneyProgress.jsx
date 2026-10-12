import { Check } from 'lucide-react';
import { Progress } from '@/components/ui/primitives/progress';
import { JOURNEY_STEPS } from '@/features/quote-journey/journeySteps';
import { cn } from '@/lib/cn';

export default function JourneyProgress({ current }) {
  const total = JOURNEY_STEPS.length;
  const reached = Math.min(current, total);
  const complete = current > total;
  const progress = (Math.min(current - 1, total) / total) * 100;

  return (
    <nav aria-label="Quote journey progress" className="border-b border-border bg-background">
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
        <div className="space-y-3 md:hidden">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{complete ? 'Journey complete' : `Step ${reached}: ${JOURNEY_STEPS[reached - 1].label}`}</span>
            <span className="text-xs text-muted-foreground">{complete ? 'Done' : `${reached} of ${total}`}</span>
          </div>
          <Progress value={progress} aria-label="Quote journey completion" aria-valuetext={complete ? 'Journey complete' : `${current - 1} of ${total} steps complete`} className="h-1.5" />
        </div>
        <ol className="mt-4 grid grid-cols-6 gap-2 md:mt-0" aria-label="Journey steps">
          {JOURNEY_STEPS.map((step, index) => {
            const number = index + 1;
            const done = number < current;
            const active = number === current;
            return (
              <li key={step.label} aria-current={active ? 'step' : undefined} className="flex flex-col items-center gap-2 text-center md:flex-row md:gap-2.5 md:text-left">
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium md:size-7', done ? 'border-primary bg-primary text-primary-foreground' : active ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
                  {done ? <Check className="size-3.5" aria-hidden="true" /> : number}
                </span>
                <span className={cn('text-[10px] leading-tight sm:text-xs', active ? 'font-medium text-primary' : 'text-muted-foreground')}>
                  <span className="md:hidden">{step.short}</span>
                  <span className="hidden md:inline">{step.label}</span>
                  {done && <span className="sr-only">, completed</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
