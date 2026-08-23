import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'coral' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-canvas hover:bg-ink-soft',
  coral: 'bg-coral text-white hover:bg-coral/90',
  outline:
    'border border-line bg-surface-bright text-ink hover:border-accent-strong hover:bg-surface',
  ghost: 'text-muted hover:bg-surface hover:text-ink',
  danger: 'bg-danger text-white hover:bg-danger/90',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 text-xs',
  md: 'min-h-10 px-4 text-sm',
  lg: 'min-h-11 px-5 text-sm',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
    />
  )
}

type BadgeTone = 'neutral' | 'accent' | 'coral' | 'success' | 'warning' | 'danger'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface text-muted',
  accent: 'bg-accent/20 text-ink',
  coral: 'bg-coral/15 text-coral',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
}

export function Badge({
  tone = 'neutral',
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function Panel({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`rounded-xl border border-line bg-surface-bright shadow-panel ${className}`}
    />
  )
}

export function PageHeader({
  title,
  description,
  eyebrow,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-strong">
            {eyebrow}
          </p>
        )}
        <h1 className="display-heading text-3xl text-ink sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

export function MessageState({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'danger'
  children: ReactNode
}) {
  return (
    <div
      className={`rounded-xl border px-5 py-12 text-center text-sm ${
        tone === 'danger'
          ? 'border-danger/20 bg-danger/5 text-danger'
          : 'border-line bg-surface text-muted'
      }`}
    >
      {children}
    </div>
  )
}

export const fieldClassName =
  'w-full rounded-lg border border-line bg-surface-bright px-3 py-2.5 text-sm text-ink placeholder:text-muted/70 transition-colors focus:border-accent-strong focus:outline-none'

export const selectClassName =
  'rounded-lg border border-line bg-surface-bright px-3 py-2 text-sm text-ink transition-colors focus:border-accent-strong focus:outline-none'

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  className = '',
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}) {
  if (!isOpen) return null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${className}`}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="fixed inset-0 bg-black/50 transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        id="modal-content"
        className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-surface-bright shadow-xl transition-all duration-200 sm:rounded-2xl sm:max-w-2xl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface-bright px-6 py-4 sm:rounded-t-2xl">
          <h2 id="modal-title" className="text-lg font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted hover:bg-surface hover:text-ink transition-colors"
            aria-label="Close"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-6 sm:p-6">{children}</div>
      </div>
    </div>
  )
}
