import { cn } from '@/lib/cn';

/**
 * The status label used across the product.
 *
 * One accent and a neutral scale carry every state, so a status is read from
 * its words and its weight rather than from a colour the customer has to
 * learn: `success` is filled, anything outstanding is outlined in the accent,
 * and `outline`/`muted` are quiet. Squared off like every other surface here.
 */
const VARIANTS = {
  default: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-primary bg-primary text-white',
  warning: 'border-primary bg-primary/[0.06] text-primary',
  danger: 'border-primary bg-primary/[0.06] text-primary',
  outline: 'border-line-strong text-ink-muted',
  muted: 'border-line bg-canvas-2 text-ink-muted',
};

export default function Badge({ variant = 'default', className = '', as: Tag = 'span', children, ...rest }) {
  return (
    <Tag
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[1px] border px-2 py-1',
        'font-mono text-[11px] uppercase leading-none tracking-[0.1em]',
        VARIANTS[variant] ?? VARIANTS.default,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
