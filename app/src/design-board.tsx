import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Badge, Button, Panel, fieldClassName, selectClassName } from './components/ui'
import { HomepageMocks } from './design-homepage'
import { StaticPageMocks } from './design-static'
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
  {
    name: 'Accent ink',
    value: '#0D6C80',
    utility: 'bg-accent-ink',
    detail: 'Accent-colored link text on canvas (AA 5.9:1)',
  },
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

// Dark-mode proposals for the same tokens. Rendered inside a `.dark`
// wrapper below, so each `bg-*` utility paints its real dark value — the
// hex alongside is the source of truth for review.
const darkSwatches: Swatch[] = [
  { name: 'Ink', value: '#F4F3EE', utility: 'bg-ink', detail: 'Was #1A1A2E' },
  { name: 'Ink soft', value: '#D8D7E2', utility: 'bg-ink-soft', detail: 'Was #2F2E48' },
  { name: 'Canvas', value: '#14141F', utility: 'bg-canvas', detail: 'Was #FEFCF3' },
  { name: 'Surface', value: '#1E1E2D', utility: 'bg-surface', detail: 'Was #F5F0E8' },
  { name: 'Bright', value: '#262638', utility: 'bg-surface-bright', detail: 'Was #FFFFFF' },
  { name: 'Line', value: '#37374E', utility: 'bg-line', detail: 'Was #E0DBD1' },
  { name: 'Muted', value: '#A9A9BC', utility: 'bg-muted', detail: 'Was #4A4A5A' },
  {
    name: 'Accent',
    value: '#48CAE4',
    utility: 'bg-accent',
    detail: 'Unchanged — brand pop on dark',
  },
  {
    name: 'Accent strong',
    value: '#5ED2E8',
    utility: 'bg-accent-strong',
    detail: 'Was #159AB8, lifted for dark',
  },
  {
    name: 'Accent ink',
    value: '#82DBEE',
    utility: 'bg-accent-ink',
    detail: 'Was #0D6C80, lifted for dark',
  },
  { name: 'Coral', value: '#E85D75', utility: 'bg-coral', detail: 'Unchanged' },
  {
    name: 'Coral text',
    value: '#F492A6',
    utility: 'bg-coral-text',
    detail: 'Was #A61E35 (6.7:1 on dark bright)',
  },
  { name: 'Success', value: '#2E8B73', utility: 'bg-success', detail: 'Unchanged' },
  {
    name: 'Success text',
    value: '#6FC7AC',
    utility: 'bg-success-text',
    detail: 'Was #1E6E5A (7.4:1 on dark bright)',
  },
  { name: 'Warning', value: '#B7791F', utility: 'bg-warning', detail: 'Unchanged' },
  {
    name: 'Warning text',
    value: '#D9A44C',
    utility: 'bg-warning-text',
    detail: 'Was #8C5A0F (6.6:1 on dark bright)',
  },
  { name: 'Danger', value: '#C24156', utility: 'bg-danger', detail: 'Unchanged' },
  {
    name: 'Danger text',
    value: '#E88A97',
    utility: 'bg-danger-text',
    detail: 'Was #A62B3F (6.0:1 on dark bright)',
  },
]

// Full token map: light hex → dark hex. Dots use inline styles (explicit
// hex, immune to the surrounding theme) so both ends read true anywhere.
const tokenMap: Array<{ token: string; light: string; dark: string }> = [
  { token: 'ink', light: '#1A1A2E', dark: '#F4F3EE' },
  { token: 'ink-soft', light: '#2F2E48', dark: '#D8D7E2' },
  { token: 'canvas', light: '#FEFCF3', dark: '#14141F' },
  { token: 'surface', light: '#F5F0E8', dark: '#1E1E2D' },
  { token: 'surface-bright', light: '#FFFFFF', dark: '#262638' },
  { token: 'line', light: '#E0DBD1', dark: '#37374E' },
  { token: 'muted', light: '#4A4A5A', dark: '#A9A9BC' },
  { token: 'accent', light: '#48CAE4', dark: '#48CAE4' },
  { token: 'accent-strong', light: '#159AB8', dark: '#5ED2E8' },
  { token: 'accent-dark', light: '#12839C', dark: '#12839C' },
  { token: 'accent-ink', light: '#0D6C80', dark: '#82DBEE' },
  { token: 'accent-text', light: '#0D6C80', dark: '#7CD9EC' },
  { token: 'coral', light: '#E85D75', dark: '#E85D75' },
  { token: 'coral-text', light: '#A61E35', dark: '#F492A6' },
  { token: 'success', light: '#2E8B73', dark: '#2E8B73' },
  { token: 'success-text', light: '#1E6E5A', dark: '#6FC7AC' },
  { token: 'warning', light: '#B7791F', dark: '#B7791F' },
  { token: 'warning-text', light: '#8C5A0F', dark: '#D9A44C' },
  { token: 'danger', light: '#C24156', dark: '#C24156' },
  { token: 'danger-text', light: '#A62B3F', dark: '#E88A97' },
]

function TokenMapRow({ row }: { row: (typeof tokenMap)[number] }) {
  const unchanged = row.light.toLowerCase() === row.dark.toLowerCase()
  return (
    <div className="flex items-center gap-3 border-b border-line/60 py-2 last:border-b-0">
      <p className="w-28 shrink-0 font-mono text-xs font-semibold text-ink">{row.token}</p>
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 rounded-md ring-1 ring-black/15"
        style={{ background: row.light }}
      />
      <p className="w-20 shrink-0 font-mono text-xs text-muted">{row.light}</p>
      <span aria-hidden="true" className="shrink-0 text-xs text-muted">
        →
      </span>
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 rounded-md ring-1 ring-black/15"
        style={{ background: row.dark }}
      />
      <p className="w-20 shrink-0 font-mono text-xs text-ink">{row.dark}</p>
      {unchanged && (
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-mono text-[10px] text-muted">
          same
        </span>
      )}
    </div>
  )
}

export function DarkModeMocks() {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="accent">Dark mode — proposed</Badge>
        <span className="text-xs text-muted">
          Surfaces drop to an ink-navy stack; brand hues stay identical so the mark and live states
          read the same. Only functional text variants lighten (all ≥ 4.5:1 on dark).
        </span>
      </div>
      <Panel className="p-5 sm:p-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Token map · light → dark
        </p>
        <div className="grid gap-x-10 md:grid-cols-2">
          {tokenMap.map((row) => (
            <TokenMapRow key={row.token} row={row} />
          ))}
        </div>
      </Panel>
      {/* Live preview: `.dark` flips the CSS vars, so every utility below
          paints its true dark value — this is the real render, not a mock. */}
      <div className="dark mt-5 rounded-xl border border-line bg-canvas p-5 sm:p-6">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Live preview · true dark render
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {darkSwatches.map((swatch) => (
            <SwatchCard key={swatch.name} swatch={swatch} />
          ))}
        </div>
        <div className="mt-5 overflow-hidden rounded-xl border border-line bg-surface-bright">
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
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="coral">Accent</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Badge tone="accent">Active</Badge>
          <Badge tone="success">Saved</Badge>
          <Badge tone="danger">Error</Badge>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
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
        </div>
        <p className="mt-5 text-sm leading-7">
          Body copy stays <span className="text-muted">muted #A9A9BC (7.9:1)</span> with{' '}
          <a href="#dark-mode" onClick={(e) => e.preventDefault()}>
            <span className="link-brand">branded links #82DBEE</span>
          </a>{' '}
          and <span className="text-accent-text">functional accent #7CD9EC (11.3:1)</span> — plus{' '}
          <span className="text-success-text">success</span>,{' '}
          <span className="text-warning-text">warning</span>, and{' '}
          <span className="text-danger-text">danger</span> text variants.
        </p>
      </div>
    </>
  )
}

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

type TabSpec = {
  label: string
  scale: number
  shiftY: number
  note: string
}

// Shipped favicon reference: the mini mark's window math (1.18× the legacy
// 92% fit, shifted up 9% / left 8%) is baked into export.py's pad math
// (FAVICON_SCALE / FAVICON_SHIFT); the unshifted mini source stays at
// docs/design/mark/v6-color-mini.svg.
const tabVariants: TabSpec[] = [
  {
    label: 'shipped',
    scale: 1,
    shiftY: 0,
    note: 'favicon.svg as generated — off-center window baked in at export time',
  },
]

function FaviconBox({ boxPx, scale, shiftY }: { boxPx: number; scale: number; shiftY: number }) {
  return (
    <span
      className="inline-block shrink-0 overflow-hidden rounded-[2px] bg-surface-bright ring-1 ring-line"
      style={{ width: boxPx, height: boxPx }}
    >
      <img
        src="/favicon.svg"
        alt=""
        style={{
          width: '100%',
          height: '100%',
          transform: `translateY(${shiftY}%) scale(${scale})`,
        }}
      />
    </span>
  )
}

function TabVariantRow({ label, scale, shiftY, note }: TabSpec) {
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-4 border-b border-line/60 py-6 last:border-b-0">
      <div className="w-64 shrink-0">
        <p className="font-mono text-xs font-semibold text-ink">{label}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted">{note}</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-end gap-1.5 bg-surface px-2 pt-2">
          <div className="flex items-center gap-2 rounded-t-lg border border-b-0 border-line bg-surface-bright px-3 pt-1.5 pb-1">
            <FaviconBox boxPx={16} scale={scale} shiftY={shiftY} />
            <span className="text-xs whitespace-nowrap text-ink">
              CoasterRank — A live ranking of the world&apos;s roller coasters
            </span>
          </div>
          <div className="rounded-t-lg border border-b-0 border-line/50 bg-surface-bright/40 px-3 pt-1.5 pb-1 text-xs text-muted">
            Park detail
          </div>
          <div className="rounded-t-lg border border-b-0 border-line/50 bg-surface-bright/40 px-3 pt-1.5 pb-1 text-xs text-muted">
            My coasters
          </div>
        </div>
        <div className="h-px bg-line" />
      </div>
      <div className="flex items-center gap-3">
        <FaviconBox boxPx={64} scale={scale} shiftY={shiftY} />
        <span className="font-mono text-[10px] leading-4 text-muted">
          16px tab
          <br />
          64px lens
        </span>
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
            <img
              src="/logo-reversed.svg"
              alt=""
              width="1444"
              height="1113"
              decoding="async"
              className="h-10 w-auto"
            />
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
        <Section title="Homepage rework">
          <HomepageMocks />
        </Section>

        <div className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
            CoasterRank design system
          </p>
          <h1 className="display-heading text-5xl text-ink sm:text-6xl">A rideable data system.</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
            This page is a living reference for the tokens, typography, and shared UI patterns used
            in the product. It has no data connection and is intentionally unlinked from the app.
          </p>
        </div>

        <Section title="Favicon in tab">
          <Panel className="px-6 py-2 sm:px-8">
            <p className="py-4 text-sm leading-6 text-muted">
              Shipped favicon window: the mini mark grown past full-width (1.18× the legacy 92% fit)
              and shifted up 9% / left 8% of the square — heart keeps right clearance, hill tail
              clips off the left edge, bottom pad breathes. Baked into{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">export.py</code> (
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                FAVICON_SCALE / FAVICON_SHIFT
              </code>
              ); the unshifted mini source stays at{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                docs/design/mark/v6-color-mini.svg
              </code>
              .
            </p>
            {tabVariants.map((spec) => (
              <TabVariantRow key={spec.label} {...spec} />
            ))}
          </Panel>
        </Section>

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
                docs/design/logo-archive
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
                <p className="flex flex-wrap items-baseline gap-x-1">
                  <img
                    src="/logo.svg"
                    alt=""
                    width="1444"
                    height="1113"
                    decoding="async"
                    className="h-[3.3rem] w-auto sm:h-[4rem]"
                  />
                  <span className="display-heading -translate-y-[0.12em] text-[2.1rem] leading-none tracking-wide text-ink sm:text-[2.6rem]">
                    Coaster<span className="text-coral">Rank</span>
                  </span>
                </p>
                <p className="flex items-center gap-2 text-sm text-muted">
                  <span className="tabular-nums">1,235 coasters · 34 countries</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-accent-text">
                    <span className="inline-flex h-2 w-2 rounded-full bg-accent" />
                    Live
                  </span>
                </p>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted">
                Masthead heading is mark + wordmark only — the descriptor copy is gone; the status
                line carries the live claim (right-aligned, track flourish above). Brand rows use{' '}
                <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">
                  items-baseline
                </code>{' '}
                so the mark&apos;s bottom edge sits on the wordmark baseline, with a deep optical
                rise (
                <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs">-0.12em</code> on
                the wordmark) so it rides the mark&apos;s mid-slope — the mark towers ~2.1× cap
                height at a tight 4px gap.
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

        <Section title="Dark mode">
          <DarkModeMocks />
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

        <Section title="Static pages">
          <StaticPageMocks />
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
