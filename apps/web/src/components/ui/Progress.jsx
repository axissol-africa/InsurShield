import { cn } from '@/lib/cn';

/**
 * A determinate progress bar (shadcn/ui's `Progress`, without the Radix
 * dependency — the primitive it wraps is a div with the right ARIA).
 *
 * @param {number} value  0–100; anything outside that range is clamped.
 */
export default function Progress({ value = 0, className = '', barClassName = '', ...rest }) {
  const percent = Math.min(100, Math.max(0, Number(value) || 0));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
      {...rest}
    >
      <div
        className={cn('h-full rounded-full bg-primary transition-[width] duration-500 ease-out', barClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
