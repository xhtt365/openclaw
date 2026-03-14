'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

type ToastContextValue = {
  onOpenChange?: (open: boolean) => void
  variant?: 'default' | 'destructive'
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const toastVariants = cva(
  'pointer-events-auto fixed top-4 right-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg',
  {
    variants: {
      variant: {
        default: 'border bg-background text-foreground',
        destructive:
          'border-destructive bg-destructive text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const ToastProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>

const ToastViewport = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    aria-hidden
    className={cn('pointer-events-none fixed inset-0 z-[99]', className)}
    {...props}
  />
)

const Toast = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> &
    VariantProps<typeof toastVariants> & {
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }
>(({ className, variant, open = true, onOpenChange, ...props }, ref) => {
  if (!open) {
    return null
  }

  return (
    <ToastContext.Provider value={{ onOpenChange, variant: variant ?? 'default' }}>
      <div
        ref={ref}
        className={cn(toastVariants({ variant }), className)}
        data-state={open ? 'open' : 'closed'}
        {...props}
      />
    </ToastContext.Provider>
  )
})
Toast.displayName = 'Toast'

const ToastAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<'button'>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
ToastAction.displayName = 'ToastAction'

const ToastClose = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<'button'>
>(({ className, onClick, ...props }, ref) => {
  const context = React.useContext(ToastContext)

  return (
    <button
      ref={ref}
      className={cn(
        'absolute right-2 top-2 rounded-md p-1 text-current/70 opacity-80 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2',
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) {
          context?.onOpenChange?.(false)
        }
      }}
      toast-close=""
      {...props}
    >
      <X className="h-4 w-4" />
    </button>
  )
})
ToastClose.displayName = 'ToastClose'

const ToastTitle = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm font-semibold', className)}
    {...props}
  />
))
ToastTitle.displayName = 'ToastTitle'

const ToastDescription = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm opacity-90', className)}
    {...props}
  />
))
ToastDescription.displayName = 'ToastDescription'

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
