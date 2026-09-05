import type { ReactNode } from 'react'
import { Badge, Panel } from './components/ui'
import { MathDisclosure, Tex } from './components/MathDisclosure'

// Static-page language captured from the About rework: editorial column,
// display section heads, dek, link treatments, and sigma-pill disclosures —
// the recipe for future prose pages (FAQ, Terms, Privacy…).

const TIERS: Array<{ token: string; spec: string; note: string }> = [
  {
    token: 'container',
    spec: 'max-w-[35rem]',
    note: '65–75 chars/line at body size — narrow the column, never shrink the font',
  },
  {
    token: 'h1',
    spec: 'display-heading text-3xl text-ink',
    note: 'Page title, one per page',
  },
  {
    token: 'dek',
    spec: 'text-[17px] font-medium leading-relaxed text-ink',
    note: 'One-line standfirst under the h1; ~5% under h1 scale, medium ink — not bold',
  },
  {
    token: 'section',
    spec: 'section-heading (mb-3)',
    note: 'Display family at text-lg, upright — the face leans on its own; no italic',
  },
  {
    token: 'body',
    spec: 'text-sm leading-7 text-muted',
    note: 'mt-3 between paragraphs; space-y-10 between sections; mb-3 under section heads',
  },
  {
    token: 'disclosure',
    spec: 'MathDisclosure',
    note: 'Collapsed by default; open copy swaps to the dismiss line; lazy-loaded content',
  },
  {
    token: 'formula',
    spec: 'formula-box',
    note: 'Bright boxed row for display equations inside a disclosure',
  },
]

function SpecRow({ tier }: { tier: (typeof TIERS)[number] }) {
  return (
    <div className="border-b border-line/60 py-3 first:pt-0 last:border-b-0">
      <p className="font-mono text-xs font-semibold text-ink">{tier.token}</p>
      <p className="mt-0.5 font-mono text-xs text-accent-ink">{tier.spec}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{tier.note}</p>
    </div>
  )
}

function DeadLink({ children }: { children: ReactNode }) {
  return (
    <a href="#specimen" onClick={(e) => e.preventDefault()}>
      {children}
    </a>
  )
}

function StaticPageAnatomy() {
  return (
    <Panel className="p-5 sm:p-6">
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Page anatomy · About
      </p>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,38rem)]">
        <div>
          {TIERS.map((tier) => (
            <SpecRow key={tier.token} tier={tier} />
          ))}
        </div>
        {/* px-6 + 38rem column = 35rem content box, matching the real page */}
        <div className="rounded-xl border border-line bg-canvas px-6 py-6">
          <p className="display-heading text-3xl text-ink">About</p>
          <p className="mt-3 text-[17px] font-medium leading-relaxed text-ink">
            CoasterRank is a free, open-source leaderboard for roller coasters.
          </p>
          <h2 className="section-heading mt-6">How the ranking works</h2>
          <p className="mt-2 text-sm leading-7 text-muted">
            When you rank the coasters here from best to worst, you&apos;re quietly casting
            thousands of votes at once — and{' '}
            <DeadLink>
              <span className="link-brand">branded links</span>
            </DeadLink>{' '}
            stay rare, next to{' '}
            <DeadLink>
              <span className="underline transition-colors hover:text-ink">quiet utility ones</span>
            </DeadLink>
            .
          </p>
          <div className="mt-5">
            <MathDisclosure>
              <p>
                Every coaster <Tex tex="i" /> carries a hidden positive strength <Tex tex="p_i" /> —
                head-to-heads are weighted coin flips:
              </p>
              <div className="formula-box mt-4">
                <Tex
                  display
                  tex={'\\Pr\\bigl(i \\text{ beats } j\\bigr) = \\frac{p_i}{p_i + p_j}'}
                />
              </div>
            </MathDisclosure>
          </div>
        </div>
      </div>
    </Panel>
  )
}

export function StaticPageMocks() {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="accent">Static pages — language</Badge>
        <span className="text-xs text-muted">
          Captured from the About rework (PR #139): editorial column, display section heads, dek,
          link treatments, and sigma-pill disclosures for future prose pages (FAQ, Terms…).
        </span>
      </div>
      <StaticPageAnatomy />
      <Panel className="mt-5 p-5 sm:p-6">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Inline links · two families, deliberately unequal
        </p>
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <div>
            <p className="text-sm leading-7">
              especially loved{' '}
              <DeadLink>
                <span className="link-brand">VoteCoasters</span>
              </DeadLink>
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">
              <code className="rounded bg-surface px-1 py-0.5 font-mono">.link-brand</code> —
              content links worth a click:{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">accent-ink</code> cyan +
              coral underline,{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">hover:text-ink</code>.
              Budget: one or two per paragraph — the restraint is the point.
            </p>
          </div>
          <div>
            <p className="text-sm leading-7">
              More questions? Read the{' '}
              <DeadLink>
                <span className="underline transition-colors hover:text-ink">FAQ</span>
              </DeadLink>
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">
              Quiet{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">
                underline hover:text-ink
              </code>{' '}
              for utility links (nav, back links, footers) — ink, never accent.
            </p>
          </div>
        </div>
      </Panel>
      <Panel className="mt-5 p-5 sm:p-6">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Math disclosures · opt-in, lazy, playful
        </p>
        <div className="max-w-[35rem]">
          <MathDisclosure>
            <p>
              Two live instances ship on <span className="font-mono text-xs">/about</span> — the
              pill is the affordance, KaTeX (+fonts) loads as a dynamic chunk on first open, and the
              open state swaps to the dismiss copy:
            </p>
            <div className="formula-box mt-4">
              <Tex
                display
                tex={
                  'p_i^{\\,\\mathrm{next}} \\;=\\; \\frac{W_i + \\tfrac{a}{2} + \\lambda}{\\displaystyle\\sum_{j}\\frac{n_{ij}}{p_i + p_j} + \\frac{a}{p_i + 1} + \\lambda}'
                }
              />
            </div>
          </MathDisclosure>
          <MathDisclosure label="Show me the weighting">
            <p>
              Per-rider influence normalization — every list sums to one unit of sway, so the board
              belongs to the community, not whoever has the most credits.
            </p>
            <div className="formula-box mt-4">
              <Tex
                display
                tex={
                  '\\begin{aligned}\nw &= \\frac{1}{\\,n(n-1)/2\\,} \\\\[2pt]\n&\\Longrightarrow\\quad \\sum w = 1 \\text{ per rider}\n\\end{aligned}'
                }
              />
            </div>
          </MathDisclosure>
        </div>
      </Panel>
    </>
  )
}
