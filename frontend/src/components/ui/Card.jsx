import { cn } from '@/lib/cn';

export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-gray-100 bg-white text-on-surface shadow-sm",
        className
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }) {
  return (
    <div
      className={cn("flex flex-col space-y-1.5 p-6", className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }) {
  return (
    <h3
      className={cn(
        "text-[20px] font-semibold leading-none tracking-tight text-primary",
        className
      )}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }) {
  return (
    <p
      className={cn("text-[14px] text-on-surface-variant", className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }) {
  return (
    <div className={cn("p-6 pt-0", className)} {...props} />
  )
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      className={cn("flex items-center p-6 pt-0", className)}
      {...props}
    />
  )
}
