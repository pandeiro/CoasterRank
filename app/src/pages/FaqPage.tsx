import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: 'Why head-to-head instead of star ratings?',
    a: (
      <p>
        Star averages are easy to inflate, and everyone rates on a different scale — one
        rider&apos;s 8 is another&apos;s 10. Head-to-head results only ask which rode higher, so
        they compare cleanly across thousands of riders with different tastes and different
        strictness.
      </p>
    ),
  },
  {
    q: 'How do I add my rankings?',
    a: (
      <p>
        Create an account, add the coasters you&apos;ve ridden, then drag them into your own
        best-to-worst order. Everything saves as you go, and your list feeds the board
        automatically. You don&apos;t need hundreds of credits — rank whatever you&apos;ve actually
        ridden, even if it&apos;s five.
      </p>
    ),
  },
  {
    q: 'What do the scores mean?',
    a: (
      <p>
        They&apos;re Bradley-Terry strength scores on an index where 100 is the community average: a
        coaster at 112 rode higher than average more often, one at 93 rode lower. See{' '}
        <Link to="/about" className="underline transition-colors hover:text-ink">
          How the ranking works
        </Link>{' '}
        for the plain-English version.
      </p>
    ),
  },
  {
    q: 'Why is my favorite coaster ranked low?',
    a: (
      <p>
        The board reflects every rider, not any single list — disagreement is the point. Coasters
        with a <em>few votes</em> badge have especially provisional scores, so the kindest thing you
        can do for an underrated gem is keep ranking it.
      </p>
    ),
  },
  {
    q: 'A coaster is missing — or the data is wrong.',
    a: (
      <p>
        Missing coasters can be submitted via the{' '}
        <Link to="/submit" className="underline transition-colors hover:text-ink">
          Submit page
        </Link>
        . Spotted an error — a wrong park, a coaster that&apos;s gone defunct? Open an issue on{' '}
        <a
          href="https://github.com/pandeiro/CoasterRank/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="underline transition-colors hover:text-ink"
        >
          GitHub
        </a>{' '}
        or email{' '}
        <a
          href="mailto:coaster.rank.app@gmail.com"
          className="underline transition-colors hover:text-ink"
        >
          coaster.rank.app@gmail.com
        </a>
        .
      </p>
    ),
  },
  {
    q: 'How often do the rankings update?',
    a: (
      <p>
        The whole board refits itself every 15 minutes, and there's some caching to handle surges,
        so your votes show up quickly. Generally within a half hour or less.
      </p>
    ),
  },
  {
    q: 'Can I use the rankings or data in my own project?',
    a: (
      <p>
        Yes. The code is MIT-licensed on{' '}
        <a
          href="https://github.com/pandeiro/CoasterRank"
          target="_blank"
          rel="noopener noreferrer"
          className="underline transition-colors hover:text-ink"
        >
          GitHub
        </a>
        , and community-contributed data is CC&nbsp;BY&nbsp;4.0 — attribute CoasterRank and go ride
        with it. We're working on API access to make it easier for projects and agents to get at it.
        Reach out if interested.
      </p>
    ),
  },
  {
    q: 'Who runs this?',
    a: (
      <p>
        It&apos;s an open-source side project run on love of the hobby — not a company. No ads, no
        sales pitches. Contributions of code, data, and strong opinions are all welcome.
      </p>
    ),
  },
]

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="display-heading text-3xl text-ink">FAQ</h1>

      <div className="mt-8 space-y-8 text-sm leading-7 text-muted">
        {QUESTIONS.map(({ q, a }) => (
          <section key={q}>
            <h2 className="mb-3 text-base font-semibold text-ink">{q}</h2>
            {a}
          </section>
        ))}
      </div>

      <div className="mt-12 border-t border-line pt-6">
        <Link to="/" className="text-xs text-muted underline transition-colors hover:text-ink">
          &larr; Back to the board
        </Link>
      </div>
    </div>
  )
}
