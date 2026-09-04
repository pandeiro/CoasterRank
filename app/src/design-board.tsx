import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Badge, Button, Panel, fieldClassName, selectClassName } from './components/ui'
import './index.css'

type Swatch = {
  name: string
  value: string
  utility: string
  detail: string
}

const swatches: Swatch[] = [
  { name: 'Ink', value: '#1A1A2E', utility: 'bg-ink', detail: 'Structure and primary text' },
  { name: 'Ink soft', value: '#2F2E48', utility: 'bg-ink-soft', detail: 'Supporting emphasis' },
  { name: 'Canvas', value: '#FEFCF3', utility: 'bg-canvas', detail: 'Page background' },
  { name: 'Surface', value: '#F5F0E8', utility: 'bg-surface', detail: 'Quiet panels and controls' },
  {
    name: 'Bright',
    value: '#FFFFFF',
    utility: 'bg-surface-bright',
    detail: 'Cards and form surfaces',
  },
  { name: 'Line', value: '#E0DBD1', utility: 'bg-line', detail: 'Borders and dividers' },
  { name: 'Muted', value: '#4A4A5A', utility: 'bg-muted', detail: 'Metadata and secondary text' },
  {
    name: 'Accent',
    value: '#48CAE4',
    utility: 'bg-accent',
    detail: 'Interactive emphasis, active filters, live states',
  },
  { name: 'Accent strong', value: '#159AB8', utility: 'bg-accent-strong', detail: 'Accent text' },
  { name: 'Coral', value: '#E85D75', utility: 'bg-coral', detail: 'Brand emphasis' },
  { name: 'Success', value: '#2E8B73', utility: 'bg-success', detail: 'Successful operations' },
  { name: 'Warning', value: '#B7791F', utility: 'bg-warning', detail: 'Cautionary states' },
  {
    name: 'Danger',
    value: '#C24156',
    utility: 'bg-danger',
    detail: 'Errors and destructive actions',
  },
]

const spacing = [1, 2, 3, 4, 6, 8, 10, 12]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-14">
      <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h2 className="display-heading text-2xl text-ink">{title}</h2>
        <span className="text-xs uppercase tracking-[0.14em] text-muted">Reference</span>
      </div>
      {children}
    </section>
  )
}

function SwatchCard({ swatch }: { swatch: Swatch }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-bright shadow-panel">
      <div className={`h-20 ${swatch.utility}`} />
      <div className="p-3">
        <p className="font-semibold text-ink">{swatch.name}</p>
        <p className="mt-0.5 font-mono text-xs text-muted">{swatch.value}</p>
        <p className="mt-2 text-xs leading-5 text-muted">{swatch.detail}</p>
      </div>
    </div>
  )
}

export function DesignBoard() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-ink text-canvas">
        <div className="page-container flex items-center justify-between gap-6 py-5">
          <div className="flex items-baseline gap-3">
            <img src="/logo-reversed.svg" alt="" className="h-10 w-auto" />
            <div>
              <p className="display-heading text-2xl tracking-wide">
                Coaster<span className="text-coral">Rank</span>
              </p>
              <p className="text-xs text-canvas/65">Design board · v6 mark</p>
            </div>
          </div>
          <Badge tone="accent" className="bg-accent/25 text-canvas">
            Live reference
          </Badge>
        </div>
      </header>

      <main className="page-container py-10 sm:py-14">
        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-strong">
            CoasterRank design system
          </p>
          <h1 className="display-heading text-5xl text-ink sm:text-6xl">A rideable data system.</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
            This page is a living reference for the tokens, typography, and shared UI patterns used
            in the product. It has no data connection and is intentionally unlinked from the app.
          </p>
        </div>

        <Section title="Mark">
          <Panel className="p-6 sm:p-8">
            <div className="flex flex-wrap items-end gap-4 sm:gap-6">
              <img
                src="/logo.svg"
                alt="CoasterRank mark — hill, track, heart"
                className="h-16 w-auto sm:h-24"
              />
              <img
                src="/favicon.svg"
                alt="CoasterRank mini mark, square-padded (favicon source)"
                className="h-16 w-16 sm:h-24 sm:w-24"
              />
              <span className="display-heading text-5xl tracking-wide text-ink sm:text-7xl">
                Coaster<span className="text-coral">Rank</span>
              </span>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  Hill · Ink #202030
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  The first drop. The ink silhouette anchors the mark; reversed to canvas on dark
                  surfaces and the app icon tile.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  Track · Accent #48CAE4
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  The ride — lift, drop, and loop, drawn as the mark&apos;s spine with its support
                  columns.
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  Heart · Coral #E85D75
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Why we ride — the loop&apos;s stitching threads the heart.
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted">
              Two approved sources, both recolored to the design tokens with ink-tight viewboxes:{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                v6-color-full.svg
              </code>{' '}
              (viewBox 1443.9 × 1113.2 — header, hero, social cards) and{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                v6-color-mini.svg
              </code>{' '}
              (viewBox 1916.3 × 1471.4 — simplified for small sizes). Shipped as{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">/logo.svg</code>{' '}
              (full mark),{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">/favicon.svg</code>{' '}
              (square-padded mini, for the tab),{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                /logo-reversed.svg
              </code>{' '}
              (dark surfaces), and{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                apple-touch-icon.png
              </code>{' '}
              (180 × 180 ink tile with the reversed mini). Regenerate everything with{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                python3 docs/design/mark/export.py
              </code>
              . Earlier marks are archived in{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                docs/logo-archive
              </code>
              .
            </p>
          </Panel>
        </Section>

        <Section title="Headings">
          <Panel className="space-y-6 p-6 sm:p-8">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Masthead heading · BoardPage
              </p>
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                <p className="flex flex-wrap items-baseline gap-x-2 sm:gap-x-2.5">
                  <img src="/logo.svg" alt="" className="h-11 w-auto sm:h-[3.3rem]" />
                  <span className="display-heading -translate-y-[0.06em] text-[2.1rem] leading-none tracking-wide text-ink sm:text-[2.6rem]">
                    Coaster<span className="text-coral">Rank</span>
                  </span>
                </p>
                <p className="flex items-center gap-2 text-sm text-muted">
                  <span className="tabular-nums">1,235 coasters · 34 countries</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-accent-strong">
                    <span className="inline-flex h-2 w-2 rounded-full bg-accent" />
                    Live
                  </span>
                </p>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">
                Masthead heading is mark + wordmark only — the descriptor copy is gone; the status
                line carries the live claim. Brand rows use{' '}
                <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                  items-baseline
                </code>{' '}
                so the mark&apos;s bottom edge sits on the wordmark baseline, with a small optical
                rise (
                <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">-0.06em</code> on
                the wordmark) so it nestles into the mark&apos;s right slope instead of hanging at
                its bottom edge.
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Display · Racing Sans One
              </p>
              <p className="display-heading text-5xl text-ink sm:text-6xl">Fury 325</p>
              <p className="mt-2 text-sm text-muted">
                Page titles, rank numbers, and brand moments.
              </p>
            </div>
          </Panel>
        </Section>

        <Section title="Colors">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {swatches.map((swatch) => (
              <SwatchCard key={swatch.name} swatch={swatch} />
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <Panel className="space-y-8 p-6 sm:p-8">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Display · Racing Sans One
              </p>
              <p className="display-heading text-5xl text-ink sm:text-6xl">Fury 325</p>
              <p className="mt-2 text-sm text-muted">
                Page titles, rank numbers, and brand moments.
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Body · Inter
              </p>
              <p className="text-xl font-semibold tabular-nums text-ink">
                1,235 coasters · 34 countries
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Supporting copy should stay readable and calm around the ranking data. Numerals are
                tabular so counts and scores align; metadata, form labels, and controls use the same
                body family.
              </p>
            </div>
          </Panel>
        </Section>

        <Section title="Spacing">
          <Panel className="p-5 sm:p-6">
            <div className="flex flex-wrap items-end gap-5">
              {spacing.map((size) => (
                <div key={size} className="flex flex-col items-center gap-2">
                  <div
                    className="rounded bg-accent"
                    style={{ height: `${size * 0.25}rem`, width: `${size * 0.25}rem` }}
                  />
                  <span className="font-mono text-xs text-muted">{size}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm text-muted">
              Tailwind spacing units remain the shared rhythm.
            </p>
          </Panel>
        </Section>

        <Section title="Buttons and badges">
          <Panel className="flex flex-wrap items-center gap-3 p-5 sm:p-6">
            <Button>Primary</Button>
            <Button variant="coral">Accent</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Badge>Neutral</Badge>
            <Badge tone="accent">Active</Badge>
            <Badge tone="coral">Highlight</Badge>
            <Badge tone="success">Saved</Badge>
            <Badge tone="warning">Few votes</Badge>
            <Badge tone="danger">Error</Badge>
          </Panel>
        </Section>

        <Section title="Form controls">
          <Panel className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
            <label className="text-sm font-medium text-ink-soft">
              Search
              <input className={`mt-2 ${fieldClassName}`} placeholder="Search coasters…" />
            </label>
            <label className="text-sm font-medium text-ink-soft">
              Material
              <select className={`mt-2 w-full ${selectClassName}`} defaultValue="steel">
                <option value="steel">Steel</option>
                <option value="wood">Wood</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </label>
          </Panel>
        </Section>

        <Section title="Ranking row">
          <Panel className="overflow-hidden">
            <div className="flex items-center gap-4 border-b border-line bg-surface/70 px-4 py-4 sm:px-5">
              <span className="display-heading text-xl text-muted/75">1</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-ink">Steel Vengeance</p>
                  <Badge tone="coral">12 (30%)</Badge>
                </div>
                <p className="truncate text-sm text-muted">Cedar Point</p>
              </div>
              <span className="text-sm tabular-nums text-muted">102.9</span>
            </div>
            <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
              <span className="display-heading text-xl text-muted/75">2</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold text-ink">Fury 325</p>
                  <Badge tone="warning">few votes</Badge>
                </div>
                <p className="truncate text-sm text-muted">Carowinds</p>
              </div>
              <span className="text-sm tabular-nums text-muted">102.6</span>
            </div>
          </Panel>
        </Section>

        <Section title="Surface and state">
          <div className="grid gap-4 sm:grid-cols-3">
            <Panel className="p-5">
              <p className="text-sm font-semibold text-ink">Default surface</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                Quiet structure for most product content.
              </p>
            </Panel>
            <Panel className="border-accent/30 bg-accent/10 p-5">
              <p className="text-sm font-semibold text-ink">Active surface</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                Use accent color to orient, not decorate.
              </p>
            </Panel>
            <Panel className="border-danger/20 bg-danger/5 p-5">
              <p className="text-sm font-semibold text-danger">Error surface</p>
              <p className="mt-2 text-sm leading-6 text-danger/80">
                Errors should remain visible and specific.
              </p>
            </Panel>
          </div>
        </Section>

        <footer className="mt-16 border-t border-line pt-6 text-xs text-muted">
          Source: <code>app/src/index.css</code>, <code>app/tailwind.config.js</code>, and{' '}
          <code>app/src/components/ui.tsx</code>.
        </footer>
      </main>
    </div>
  )
}

createRoot(document.getElementById('design-root')!).render(
  <StrictMode>
    <DesignBoard />
  </StrictMode>,
)
