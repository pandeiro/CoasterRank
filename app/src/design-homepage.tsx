import type { ReactNode } from 'react'
import { Badge, Panel } from './components/ui'

// TEMP (homepage rework — punchlist §5.3/§6.1/§6.2/§7.1 + header placement):
// side-by-side mocks so final calls are made here, not in app code. The
// "Decided / start" defaults (rider-share tokens 1:1) are marked; alternatives
// stay until the winner ships. Delete the section once decisions are baked in.

function MockLabel({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
      {children}
      {note && <span className="ml-2 font-normal normal-case tracking-normal">{note}</span>}
    </p>
  )
}

// The status-line link, per final copy: plain "About" (fits mobile).
function HowItWorks() {
  return <span className="text-sm font-medium text-ink hover:text-accent-dark">About</span>
}

function StatusCounts({ users }: { users?: number }) {
  return (
    <>
      <span className="tabular-nums">1,235 coasters</span>
      <span aria-hidden="true">·</span>
      <span className="tabular-nums">34 countries</span>
      {users !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{users} users</span>
        </>
      )}
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1.5 font-medium text-accent-strong">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        Live
      </span>
    </>
  )
}

function MastheadLockup() {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1">
      <img src="/logo.svg" alt="" className="h-[3.7rem] w-auto sm:h-[4.5rem]" />
      <span className="display-heading -translate-y-[0.12em] text-[2.4rem] leading-none tracking-wide text-ink sm:text-[2.9rem]">
        Coaster<span className="text-coral">Rank</span>
      </span>
    </p>
  )
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-[390px] max-w-full rounded-2xl border border-line bg-canvas p-4 shadow-panel">
      {children}
    </div>
  )
}

function HeroVariants() {
  return (
    <div className="space-y-8">
      {/* Variant B — spec reading: one line under the brand; How left, counts right. */}
      <div>
        <MockLabel note="How-it-works at container left, counts right (spec §1.2 reading)">
          Variant B · line under brand
        </MockLabel>
        <Panel className="p-5 sm:p-6">
          <MastheadLockup />
          <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <HowItWorks />
            <span className="flex items-center gap-2">
              <StatusCounts users={61} />
            </span>
          </p>
        </Panel>
        <p className="mt-2 text-xs leading-5 text-muted">
          Hero reservation would grow: brand ~72px + line ~20px → <code>min-h-[6.25rem]</code>.
        </p>
      </div>

      {/* Variant A — status line stays beside the brand; How leads the line. */}
      <div>
        <MockLabel note="brand left, [How + counts] right (current arrangement, How prepended)">
          Variant A · line beside brand
        </MockLabel>
        <Panel className="p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <MastheadLockup />
            <p className="flex items-center gap-2 text-sm text-muted">
              <HowItWorks />
              <span aria-hidden="true">·</span>
              <StatusCounts users={61} />
            </p>
          </div>
        </Panel>
        <p className="mt-2 text-xs leading-5 text-muted">
          Keeps today's <code>min-h-[5.5rem]</code> reservation; How-it-works rides at the line's
          left edge.
        </p>
      </div>

      {/* Mobile — §2.4: centered lockup, forced break, centered status line
          with About leading (same separators, no extra gap). */}
      <div>
        <MockLabel note="mobile: centered lockup, centered status line">Mobile</MockLabel>
        <PhoneFrame>
          <p className="flex justify-center">
            <MastheadLockup />
          </p>
          <p className="mt-2 flex w-full items-center justify-center gap-2 text-center text-sm text-muted">
            <HowItWorks />
            <span aria-hidden="true">·</span>
            <StatusCounts />
          </p>
        </PhoneFrame>
      </div>
    </div>
  )
}

function LivePopunder() {
  return (
    <div>
      <MockLabel note="hover/click/focus; outside click, Esc, blur dismiss">
        Live ● popunder (§2.3)
      </MockLabel>
      <Panel className="p-5 sm:p-6">
        <p className="flex items-center gap-2 text-sm text-muted">
          <StatusCounts users={61} />
        </p>
        <div className="relative mt-1 inline-block">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-strong">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Live
          </span>
          <div className="absolute left-0 top-full z-10 mt-1.5 min-w-max rounded-lg border border-line bg-surface-bright px-3 py-2 text-xs text-muted shadow-lift">
            Last ranked 8 minutes ago
          </div>
        </div>
        <p className="mt-10 text-xs leading-5 text-muted">
          Prefers <code>last_recomputed_at</code> (pg_cron success) with <code>generated_at</code>{' '}
          (edge cache fill) as fallback; <code>Intl.RelativeTimeFormat</code>, ticking every 30s
          without refetch.
        </p>
      </Panel>
    </div>
  )
}

const RANK_ROWS: Array<{ rank: number; name: string; park: string }> = [
  { rank: 1, name: 'Steel Vengeance', park: 'Cedar Point' },
  { rank: 2, name: 'Fury 325', park: 'Carowinds' },
  { rank: 3, name: 'Iron Gwazi', park: 'Busch Gardens Tampa' },
  { rank: 47, name: 'Phantom’s Revenge', park: 'Kennywood' },
  { rank: 250, name: 'Twisted Timbers', park: 'Kings Dominion' },
  { rank: 1000, name: 'Wooden Warrior', park: 'Quassy' },
]

function rankFont(rank: number): string {
  if (rank >= 1000) return 'text-xs'
  if (rank >= 100) return 'text-sm'
  return 'text-lg'
}

function RankTreatments() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* Current */}
      <div>
        <MockLabel>Current · display font</MockLabel>
        <Panel className="overflow-hidden">
          {RANK_ROWS.map((row) => (
            <div
              key={row.rank}
              className="flex items-center gap-3 border-b border-line/70 px-4 py-3 last:border-b-0"
            >
              <span className="w-12 shrink-0 text-left text-muted/75">
                <span className="display-heading text-xl leading-none">{row.rank}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{row.name}</p>
                <p className="truncate text-xs text-muted">{row.park}</p>
              </div>
            </div>
          ))}
        </Panel>
        <p className="mt-2 text-xs leading-5 text-muted">
          Racing Sans One reads decorative; no digit alignment (§5.1).
        </p>
      </div>

      {/* Plain upright — §5.1/5.2 without the circle. */}
      <div>
        <MockLabel note="§5.1 + §5.2 only">Plain upright · right-aligned</MockLabel>
        <Panel className="overflow-hidden">
          {RANK_ROWS.map((row) => (
            <div
              key={row.rank}
              className="flex items-center gap-2 border-b border-line/70 px-4 py-3 last:border-b-0"
            >
              <span
                className={`w-[3.25rem] shrink-0 text-right font-medium tabular-nums text-ink ${rankFont(row.rank)} leading-none`}
              >
                {row.rank}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{row.name}</p>
                <p className="truncate text-xs text-muted">{row.park}</p>
              </div>
            </div>
          ))}
        </Panel>
        <p className="mt-2 text-xs leading-5 text-muted">
          Fixed width, tight gutter; one font tier down at ≥100, another at ≥1000.
        </p>
      </div>

      {/* SHIPPED: white circles around display-font accent numerals for
          EVERY rank, with a slight dark ink drop shadow — desktop + mobile. */}
      <div>
        <MockLabel note="SHIPPED — display font, accent numerals, ink shadow, all ranks">
          Circle · every rank
        </MockLabel>
        <Panel className="overflow-hidden">
          {RANK_ROWS.map((row) => (
            <div
              key={row.rank}
              className="flex items-center gap-2 border-b border-line/70 px-4 py-3 last:border-b-0"
            >
              <span
                className={`display-heading flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-center leading-none tabular-nums text-accent-strong shadow-[0_1px_2px_rgb(26_26_46_/_0.18)] ${rankFont(row.rank)}`}
              >
                {row.rank}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{row.name}</p>
                <p className="truncate text-xs text-muted">{row.park}</p>
              </div>
            </div>
          ))}
        </Panel>
        <p className="mt-2 text-xs leading-5 text-muted">
          One tier down at ≥100, another at ≥1000 so 4-digit ranks stay inside the circle.
        </p>
      </div>
    </div>
  )
}

const PALETTES: Array<{ label: string; note: string; tints: string[] }> = [
  {
    label: 'Muted coral',
    note: 'SHIPPED — 0.05 / 0.03 / 0.015, three distinct shades',
    tints: ['bg-coral/[0.05]', 'bg-coral/[0.03]', 'bg-coral/[0.015]'],
  },
  {
    label: 'Rider-share coral 1:1',
    note: 'alternative (not shipped) — 0.08 / 0.06 / 0.04',
    tints: ['bg-coral/[0.08]', 'bg-coral/[0.06]', 'bg-coral/[0.04]'],
  },
  {
    label: 'Current surface',
    note: 'before — surface/70, surface/35',
    tints: ['bg-surface/70', 'bg-surface/35', 'bg-surface/35'],
  },
]

function PaletteTreatments() {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {PALETTES.map((palette) => (
        <div key={palette.label}>
          <MockLabel note={palette.note}>{palette.label}</MockLabel>
          <Panel className="overflow-hidden">
            {RANK_ROWS.slice(0, 5).map((row, index) => (
              <div
                key={row.rank}
                className={`flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-b-0 ${
                  index < 3 ? palette.tints[index] : 'bg-surface-bright'
                }`}
              >
                <span className="w-6 shrink-0 text-right text-sm font-medium tabular-nums text-muted">
                  {row.rank}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{row.name}</p>
              </div>
            ))}
          </Panel>
        </div>
      ))}
    </div>
  )
}

const DENSITIES: Array<{ label: string; note: string; row: string; minH: string }> = [
  {
    label: '−5%',
    note: 'SHIPPED (mobile + desktop) — py-2.5 · min-h-52px',
    row: 'py-2.5',
    minH: 'min-h-[52px]',
  },
  { label: 'Current', note: 'before — py-3 · min-h-56px', row: 'py-3', minH: 'min-h-[56px]' },
  {
    label: 'Denser',
    note: 'alternative (not shipped) — py-2 · min-h-48px',
    row: 'py-2',
    minH: 'min-h-[48px]',
  },
]

function DensityTreatments() {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {DENSITIES.map((density) => (
        <div key={density.label}>
          <MockLabel note={density.note}>{density.label}</MockLabel>
          <Panel className="overflow-hidden">
            {RANK_ROWS.slice(0, 4).map((row) => (
              <div
                key={row.rank}
                className={`flex items-center gap-3 border-b border-line/70 px-4 last:border-b-0 ${density.row} ${density.minH}`}
              >
                <span className="w-6 shrink-0 text-right text-sm font-medium tabular-nums text-muted">
                  {row.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{row.name}</p>
                  <p className="truncate text-xs text-muted">{row.park}</p>
                </div>
                <span className="text-sm tabular-nums text-muted">102.9</span>
              </div>
            ))}
          </Panel>
        </div>
      ))}
    </div>
  )
}

const SCORE_TREATMENTS: Array<{ label: string; className: string }> = [
  {
    label: 'SHIPPED · accent-tint pill (600 ink)',
    className: 'rounded-md bg-accent/5 px-1.5 py-0.5 text-sm font-semibold tabular-nums text-ink',
  },
  { label: 'alternative · 500 ink', className: 'text-sm font-medium tabular-nums text-ink' },
  {
    label: 'alternative · 500 accent-strong',
    className: 'text-sm font-medium tabular-nums text-accent-strong',
  },
  {
    label: 'alternative · 600 ink + accent underline',
    className:
      'text-sm font-semibold tabular-nums text-ink underline decoration-accent decoration-2 underline-offset-4',
  },
  { label: 'before · muted', className: 'text-sm tabular-nums text-muted' },
]

function ScoreTreatments() {
  return (
    <div>
      <MockLabel note="§7.1 — pick one; weight × accent matrix">Score emphasis</MockLabel>
      <Panel className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-3 sm:p-6">
        {SCORE_TREATMENTS.map((treatment) => (
          <div key={treatment.label} className="flex items-center justify-between gap-4">
            <span className="text-xs leading-5 text-muted">{treatment.label}</span>
            <span className={treatment.className}>102.9</span>
          </div>
        ))}
      </Panel>
    </div>
  )
}

function SkeletonDemo() {
  return (
    <div>
      <MockLabel note="§8.1/§8.3 — reserved slots with pulse bars, mirrored gutter/centering">
        Skeletons
      </MockLabel>
      <div className="grid gap-5 sm:grid-cols-2">
        <Panel className="p-5 sm:p-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Hero status line
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="h-4 w-20 animate-pulse rounded bg-line/60" />
            <span className="h-4 w-16 animate-pulse rounded bg-line/60" />
            <span className="h-4 w-14 animate-pulse rounded bg-line/60" />
            <span className="h-4 w-24 animate-pulse rounded bg-line/60" />
          </p>
          <p className="mt-3 text-xs leading-5 text-muted">
            Widths reserve coasters · countries · [users] · How-it-works — even while the gated
            fields are hidden, so <code>Live</code> never shifts.
          </p>
        </Panel>
        <Panel className="p-5 sm:p-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Table rows
          </p>
          <div className="space-y-2.5">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex items-center gap-3">
                <span className="h-10 w-10 animate-pulse rounded-full bg-line/60" />
                <span className="h-4 min-w-0 flex-1 animate-pulse rounded bg-line/60" />
                <span className="h-4 w-12 animate-pulse rounded bg-line/60" />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">
            8 bars in a <code>min-h-[60vh] sm:min-h-[65vh]</code> slot; cross-fades to the table on
            load (no 82px→12k px jump).
          </p>
        </Panel>
      </div>
    </div>
  )
}

function UsersGate() {
  return (
    <div>
      <MockLabel note="SHIPPED — hidden at ≤50 and always on mobile; skeleton reserves its width on desktop only">
        Users gate (&gt;50)
      </MockLabel>
      <Panel className="space-y-4 p-5 sm:p-6">
        <div>
          <p className="mb-1 text-xs text-muted">below gate — 41 users</p>
          <p className="flex items-center gap-2 text-sm text-muted">
            <StatusCounts />
          </p>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">above gate — 61 users</p>
          <p className="flex items-center gap-2 text-sm text-muted">
            <StatusCounts users={61} />
          </p>
        </div>
      </Panel>
    </div>
  )
}

export function HomepageMocks() {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="coral">Homepage rework — mocks</Badge>
        <span className="text-xs text-muted">
          Punchlist §1–§8 · final calls baked in (marked SHIPPED): muted coral podium, all-rank
          circles, −5% density, accent-tint score pill, plain "About" link. Hero variant A/B still
          open.
        </span>
      </div>
      <Panel className="p-5 sm:p-6">
        <HeroVariants />
      </Panel>
      <Panel className="mt-5 p-5 sm:p-6">
        <LivePopunder />
      </Panel>
      <Panel className="mt-5 p-5 sm:p-6">
        <UsersGate />
      </Panel>
      <Panel className="mt-5 p-5 sm:p-6">
        <RankTreatments />
      </Panel>
      <Panel className="mt-5 p-5 sm:p-6">
        <PaletteTreatments />
      </Panel>
      <Panel className="mt-5 p-5 sm:p-6">
        <DensityTreatments />
      </Panel>
      <Panel className="mt-5 p-5 sm:p-6">
        <ScoreTreatments />
      </Panel>
      <Panel className="mt-5 p-5 sm:p-6">
        <SkeletonDemo />
      </Panel>
    </>
  )
}
