import type { ReactNode } from 'react'
import { Badge, Panel } from './components/ui'

// Shipped homepage reference — the treatments below shipped via the homepage
// rework; alternatives were pruned once the calls were baked in. The hero
// line placement A/B is the one remaining open call.

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
  return <span className="text-sm font-medium text-ink hover:text-accent-text">About</span>
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
      <span className="inline-flex items-center gap-1.5 font-medium text-accent-text">
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
      <img
        src="/logo.svg"
        alt=""
        width="1444"
        height="1113"
        decoding="async"
        className="h-[3.7rem] w-auto sm:h-[4.5rem]"
      />
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
      {/* Variant B — How left, counts right. */}
      <div>
        <MockLabel note="How-it-works at container left, counts right">
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
        <MockLabel note="brand left, [How + counts] right">Variant A · line beside brand</MockLabel>
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

      {/* Mobile — centered lockup, forced break, centered status line
          with About leading (same separators, no extra gap). */}
      <div>
        <MockLabel note="mobile: centered lockup, centered status line">Mobile</MockLabel>
        <PhoneFrame>
          <div className="flex justify-center">
            <MastheadLockup />
          </div>
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
        Live ● popunder
      </MockLabel>
      <Panel className="p-5 sm:p-6">
        <p className="flex items-center gap-2 text-sm text-muted">
          <StatusCounts users={61} />
        </p>
        <div className="relative mt-1 inline-block">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text">
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
    <div>
      <MockLabel note="display font, accent numerals, ink shadow — every rank">Ranks</MockLabel>
      <Panel className="overflow-hidden">
        {RANK_ROWS.map((row) => (
          <div
            key={row.rank}
            className="flex items-center gap-2 border-b border-line/70 px-4 py-3 last:border-b-0"
          >
            <span
              className={`display-heading flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-center leading-none tabular-nums text-accent-text shadow-[0_1px_2px_rgb(26_26_46_/_0.18)] ${rankFont(row.rank)}`}
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
  )
}

const PODIUM_TINTS = ['bg-coral/[0.05]', 'bg-coral/[0.03]', 'bg-coral/[0.015]']

function PaletteTreatments() {
  return (
    <div>
      <MockLabel note="0.05 / 0.03 / 0.015 — three distinct shades">
        Podium ramp · muted coral
      </MockLabel>
      <Panel className="overflow-hidden">
        {RANK_ROWS.slice(0, 5).map((row, index) => (
          <div
            key={row.rank}
            className={`flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-b-0 ${
              index < 3 ? PODIUM_TINTS[index] : 'bg-surface-bright'
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
  )
}

function DensityTreatments() {
  return (
    <div>
      <MockLabel note="py-2.5 · min-h-52px, mobile + desktop">Row density · −5%</MockLabel>
      <Panel className="overflow-hidden">
        {RANK_ROWS.slice(0, 4).map((row) => (
          <div
            key={row.rank}
            className="flex min-h-[52px] items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-b-0"
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
  )
}

function ScoreTreatments() {
  return (
    <div>
      <MockLabel note="accent-tint pill, 600 ink">Score emphasis</MockLabel>
      <Panel className="flex items-center justify-between gap-4 p-5 sm:p-6">
        <span className="text-xs leading-5 text-muted">shipped · rounded accent-tint pill</span>
        <span className="rounded-md bg-accent/5 px-1.5 py-0.5 text-sm font-semibold tabular-nums text-ink">
          102.9
        </span>
      </Panel>
    </div>
  )
}

function SkeletonDemo() {
  return (
    <div>
      <MockLabel note="reserved slots with pulse bars, mirrored gutter/centering">
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
      <MockLabel note="hidden at ≤50 and always on mobile; skeleton reserves its width on desktop only">
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
        <Badge tone="coral">Homepage — shipped reference</Badge>
        <span className="text-xs text-muted">
          Muted coral podium, all-rank circles, −5% density, accent-tint score pill — alternatives
          pruned once shipped. Hero line placement A/B is the remaining open call.
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
