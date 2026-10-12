import { cn } from '@/lib/cn';

/** A panel: a hairline rule around content, no elevation. Depth here comes
 * from the rule and the space around it, not from a shadow. */
export function Card({ className, ...props }) {
  return <div className={cn('rounded-[1px] border border-line bg-canvas text-ink', className)} {...props} />;
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col space-y-2 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return (
    <h3
      className={cn('text-[18px] font-medium leading-none tracking-[-0.015em] text-ink', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-[14px] leading-[1.55] text-ink-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return <div className={cn('flex items-center p-6 pt-0', className)} {...props} />;
}
