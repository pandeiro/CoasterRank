import { Link } from 'react-router-dom'
import { Formula, MathDisclosure, Tex } from '../components/MathDisclosure'

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[35rem] py-8">
      <h1 className="display-heading text-3xl text-ink">About</h1>
      <p className="mt-4 text-[17px] font-medium leading-relaxed text-ink">
        CoasterRank is a free, open-source leaderboard for roller coasters.
      </p>

      <div className="mt-8 space-y-10 text-sm leading-7 text-muted">
        <section>
          <h2 className="section-heading mb-3">Backstory</h2>
          <p>
            Coaster lover from early on. Then I grew up, as one does. Mostly forgot about them.
            Then, my son discovers them and we're right back in the queue, doing it all over again.
          </p>
          <p className="mt-3">
            We discovered the communities like{' '}
            <a
              href="https://aceonline.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="link-brand"
            >
              ACE
            </a>{' '}
            and websites and youtubers and especially loved{' '}
            <a
              href="https://votecoasters.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="link-brand"
            >
              VoteCoasters
            </a>{' '}
            -- because who doesn't love ranking stuff? When 2025 came and went without a new ranking
            there, we missed it enough to imagine building a version that stays live and never goes
            dark. That's the idea here.
          </p>
        </section>

        <section>
          <h2 className="section-heading mb-3">How the ranking works</h2>
          <p>
            When you rank the coasters here from best to worst, you're quietly casting thousands of
            votes at once: this one over that one, that one over the next, all the way down your
            list.
          </p>
          <p className="mt-3">
            <a
              href="https://en.wikipedia.org/wiki/Bradley%E2%80%93Terry_model"
              target="_blank"
              rel="noopener noreferrer"
              className="link-brand"
            >
              <strong>Bradley-Terry</strong>
            </a>{' '}
            (BT) is a statistical algorithm from the 1950s, long used to rank chess players, that
            takes everyone's lists and finds the single strength score per coaster that best
            explains all those head-to-head results. A coaster's score rises when it keeps ranking
            higher than the coasters around it, no matter what 'rating' you might think it should
            have. All we're saying is "this one is better than that one."
          </p>

          <MathDisclosure>
            <p>
              Every coaster <Tex tex="i" /> carries a hidden positive strength <Tex tex="p_i" />.
              Each head-to-head result is treated as a weighted coin flip between the two strengths:
            </p>
            <Formula tex={'\\Pr\\bigl(i \\text{ beats } j\\bigr) = \\frac{p_i}{p_i + p_j}'} />
            <p className="mt-4">
              All the community&apos;s weighted comparisons then feed a single iterative refit — an
              MM algorithm (Hunter 2004) that re-estimates every strength at once until the picture
              stops moving:
            </p>
            <Formula
              tex={
                'p_i^{\\,\\mathrm{next}} \\;=\\; \\frac{W_i + \\tfrac{a}{2} + \\lambda}{\\displaystyle\\sum_{j}\\frac{n_{ij}}{p_i + p_j} + \\frac{a}{p_i + 1} + \\lambda}'
              }
            />
            <ul className="mt-4 list-disc space-y-2 pl-5">
              <li>
                <strong className="text-ink">
                  <Tex tex="W_i" />
                </strong>{' '}
                — coaster <Tex tex="i" />
                &apos;s total weighted wins.
              </li>
              <li>
                <strong className="text-ink">
                  <Tex tex="n_{ij}" />
                </strong>{' '}
                — weighted comparisons between <Tex tex="i" /> and <Tex tex="j" />, in both
                directions.
              </li>
              <li>
                <strong className="text-ink">
                  <Tex tex="a" />
                </strong>{' '}
                — the <em>anchor</em>: a virtual 50/50 record against a synthetic
                &ldquo;average&rdquo; coaster of strength 1. It pins the scale, keeps undefeated
                coasters from drifting to infinity, and leaves a never-compared coaster sitting
                exactly at 1.0.
              </li>
              <li>
                <strong className="text-ink">
                  <Tex tex="\lambda" />
                </strong>{' '}
                — pseudo win/loss counts that gently shrink every strength toward 1.0, so a couple
                of lucky comparisons can&apos;t launch a coaster up the board.
              </li>
            </ul>
            <p className="mt-4">
              Iterate until nothing moves (
              <Tex tex="\Delta < 10^{-8}" />, capped at 500 passes), then multiply by 100 for the
              board. That&apos;s the whole trick.
            </p>
          </MathDisclosure>

          <p className="mt-3">
            If BT were just applied straight up, riders with longer lists would have more sway than
            those with less credits, because they'd generate more pair-wise wins. But CoasterRank's
            designed to try to give everybody "one vote", so we do some weighting so that every
            rider's comparisons contribute about one unit of influence to the ranking.
          </p>
          <p className="mt-3">
            So having more credits effectively gives you broader, but shallower impact -- you affect
            more coasters' scores, but affect each one less so than someone with fewer rankings.
          </p>

          <MathDisclosure label="Show me the weighting">
            <p>
              Your best-to-worst list already contains every head-to-head result -- ranking{' '}
              <Tex tex="n" /> coasters settles all of them at once:
            </p>
            <Formula
              tex={
                '\\begin{aligned}\n&\\text{a list of } n \\text{ coasters} \\\\[2pt]\n&\\quad\\Longrightarrow\\quad \\frac{n(n-1)}{2} \\text{ head-to-heads}\n\\end{aligned}'
              }
            />
            <p className="mt-4">
              To keep a 300-credit power user from out-shouting a hundred casual riders, each of
              your comparisons is weighted by the size of your list:
            </p>
            <Formula
              tex={
                '\\begin{aligned}\nw &= \\frac{1}{\\,n(n-1)/2\\,} \\\\[2pt]\n&\\Longrightarrow\\quad \\sum w = 1 \\text{ per rider}\n\\end{aligned}'
              }
            />
            <p className="mt-4">
              Rank five coasters or five hundred -- you contribute one unit of influence either way.
            </p>
          </MathDisclosure>

          <p className="mt-3">
            Scores are shown on an index where{' '}
            <strong className="text-ink">100 is the community average</strong> -- anything above it
            rode higher, more often. The whole board refits itself every 15 minutes, so rankings
            move as everybody rides and ranks and re-ranks.
          </p>
        </section>

        <section>
          <h2 className="section-heading mb-3">Open source, and open to you</h2>
          <p>
            CoasterRank is{' '}
            <a
              href="https://github.com/pandeiro/CoasterRank"
              target="_blank"
              rel="noopener noreferrer"
              className="link-brand"
            >
              open source on GitHub
            </a>{' '}
            -- code, data pipeline, and ranking math, all MIT-licensed. Pull requests, bug reports,
            and "have you considered&hellip;" comments are equally welcome; so is simply telling us
            where the model gets it wrong.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-ink">Fix the map:</strong> submit missing coasters, correct a
              wrong park or a defunct listing. The base coaster list is open data, and everything
              the community adds is licensed CC&nbsp;BY&nbsp;4.0.
            </li>
            <li>
              <strong className="text-ink">Keep riding:</strong> the easiest contribution of all is
              ranking your coasters. Every ranking improves the table!{' '}
              <em>
                (Well... unless you <strong>really</strong> love Apollo's Chariot...)
              </em>
            </li>
          </ul>
          <p className="mt-3">&mdash; pandeiro & co</p>
        </section>
      </div>

      <div className="mt-10 flex items-center gap-6 border-t border-line pt-6 text-xs">
        <Link to="/faq" className="text-muted underline transition-colors hover:text-ink">
          More questions? Read the FAQ
        </Link>
        <Link to="/" className="text-muted underline-offset-4 transition-colors hover:text-ink">
          &larr; Back to the board
        </Link>
      </div>
    </div>
  )
}
