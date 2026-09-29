import React from 'react';
import { cn } from '@/lib/cn';

/**
 * The shared button.
 *
 * A single high-contrast action treatment across the app. The large size is
 * intentionally comfortable for thumb use in the installed mobile web app.
 */
export const Button = React.forwardRef(({ className, variant = 'primary', size = 'default', asChild = false, ...props }, ref) => {
  const Comp = asChild ? React.Fragment : 'button';
  return (
    <Comp
      className={cn(
        'group relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-[1px] text-[14px] font-medium transition-colors duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint disabled:shadow-none',
        {
          'bg-primary text-white hover:bg-[#b91c1c]': variant === 'primary',
          'bg-ink text-white hover:bg-ink/90': variant === 'secondary',
          'border border-dashed border-line-strong bg-canvas text-ink hover:border-primary hover:text-primary': variant === 'outline',
          'text-primary hover:bg-primary/5': variant === 'ghost',
          'border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15': variant === 'accent',
          'min-h-11 px-4': size === 'default',
          'min-h-10 px-3 text-[13px]': size === 'sm',
          'h-14 px-8 text-[15px]': size === 'lg',
          'h-10 w-10': size === 'icon',
        },
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Button.displayName = 'Button';
