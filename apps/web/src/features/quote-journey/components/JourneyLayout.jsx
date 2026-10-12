import { useId } from 'react';
import { cn } from '@/lib/cn';
import JourneyProgress from './JourneyProgress';

export default function JourneyLayout({ step, title, description, className, children }) {
  const headingId = useId();

  return (
    <>
      <JourneyProgress current={step} />
      <section aria-labelledby={headingId} className={cn('mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10', className)}>
        <header className="mb-8 max-w-3xl">
          <h1 id={headingId} className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
          {description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</p>}
        </header>
        {children}
      </section>
    </>
  );
}
