import React from 'react';
import { cn } from '@/lib/cn';

export const Button = React.forwardRef(({ className, variant = 'primary', size = 'default', asChild = false, ...props }, ref) => {
  const Comp = asChild ? React.Fragment : "button"
  return (
    <Comp
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
        {
          "bg-primary text-white hover:bg-primary-container shadow-md shadow-primary/20": variant === "primary",
          "bg-inverse-surface text-white hover:bg-black/80 shadow-sm": variant === "secondary",
          "border-2 border-primary bg-transparent hover:bg-red-50 text-primary": variant === "outline",
          "hover:bg-surface-container text-primary": variant === "ghost",
          "bg-[#ffb4a8] text-[#3d2d2a] hover:bg-[#ffdad4]": variant === "accent",
          "h-10 px-4 py-2": size === "default",
          "h-9 rounded-xl px-3": size === "sm",
          "h-14 rounded-xl px-8 text-[16px]": size === "lg",
          "h-10 w-10": size === "icon",
        },
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = "Button"
