import { Link } from 'react-router-dom'

// Stub for the "How it works →" affordance (punchlist §1.2): one quiet page
// describing the Bradley–Terry approach at sketch level. Copy is expected to
// grow; the route and placement are the decided parts.
export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="display-heading text-3xl text-ink">How it works</h1>
      <div className="mt-8 space-y-6 text-sm leading-7 text-muted">
        <p>
          CoasterRank doesn&apos;t average star ratings — it learns from who you rode higher. Every
          time you rank your coasters, you make thousands of head-to-head comparisons, and a
          statistical model (Bradley–Terry) turns those pairings into a single strength score.
        </p>
        <p>
          Scores around 100 are the community average; anything higher rode higher, more often. The
          whole board re-fits itself on a schedule, so rankings move as the community rides.
        </p>
        <p className="italic">This page is a stub — the full explainer ships soon.</p>
      </div>
      <Link
        to="/"
        className="mt-8 inline-block text-sm font-medium text-ink underline-offset-4 hover:underline"
      >
        ← Back to the board
      </Link>
    </div>
  )
}
