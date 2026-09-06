import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react'

// katex's bundled types use `export =`, which doesn't match the CJS default
// interop shape Vite hands back from a dynamic import — type only what we use.
type Katex = {
  renderToString: (
    tex: string,
    options?: { displayMode?: boolean; throwOnError?: boolean },
  ) => string
}

// KaTeX (+ its CSS and fonts) is only fetched when a visitor first opens a
// math disclosure — the main bundle stays clean for readers who skip it.
const KatexContext = createContext<Katex | null>(null)

export function MathDisclosure({
  label = 'Show me the math',
  openLabel = "OK, that's enough math for today",
  children,
}: {
  label?: string
  openLabel?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [katex, setKatex] = useState<Katex | null>(null)
  const contentId = useId()

  useEffect(() => {
    if (!open || katex) return
    let cancelled = false
    void Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => {
      if (!cancelled) setKatex(module.default)
    })
    return () => {
      cancelled = true
    }
  }, [open, katex])

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-bright py-1 pl-1.5 pr-3 text-xs font-semibold text-ink-soft shadow-panel transition-colors hover:border-accent-text hover:text-ink"
      >
        <span
          aria-hidden="true"
          className="display-heading flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-[13px] leading-none text-accent-text"
        >
          {'\u2211'}
        </span>
        {open ? openLabel : label}
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="m2 4 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          id={contentId}
          role="region"
          aria-label={label}
          className="animate-drop-in mt-3 rounded-2xl border border-line bg-surface/60 px-5 py-4 sm:px-6"
        >
          <KatexContext.Provider value={katex}>{children}</KatexContext.Provider>
        </div>
      )}
    </div>
  )
}

export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const katex = useContext(KatexContext)
  if (!katex) return null
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false })
  if (display) {
    return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

/** Bright boxed row for a display equation inside a MathDisclosure panel. */
export function Formula({ tex }: { tex: string }) {
  return (
    <div className="formula-box mt-4 first:mt-0">
      <Tex display tex={tex} />
    </div>
  )
}
