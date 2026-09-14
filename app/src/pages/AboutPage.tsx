import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { Formula, MathDisclosure, Tex } from '../components/MathDisclosure'

const META_TITLE = 'About — CoasterRank'
const META_DESCRIPTION =
  'What CoasterRank is, how the live Bradley-Terry ranking works, and our commitments: always free, no ads, open source and open data.'

export default function AboutPage() {
  const pageUrl = `${window.location.origin}/about`
  return (
    <div className="mx-auto max-w-[35rem] py-8">
      <Helmet>
        <title>{META_TITLE}</title>
        <meta name="description" content={META_DESCRIPTION} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="CoasterRank" />
        <meta property="og:title" content={META_TITLE} />
        <meta property="og:description" content={META_DESCRIPTION} />
        <meta property="og:url" content={pageUrl} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={META_TITLE} />
        <meta name="twitter:description" content={META_DESCRIPTION} />
      </Helmet>
      {/* Organization entity for crawlers that execute JS (Google indexes
          client-rendered JSON-LD). */}
      <script type="application/ld+json">
        {JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'CoasterRank',
          url: `${window.location.origin}/`,
          logo: `${window.location.origin}/logo.svg`,
          sameAs: ['https://github.com/pandeiro/CoasterRank'],
        })}
      </script>
      <h1 className="display-heading text-3xl text-ink">About</h1>
      <p className="mt-4 text-[17px] font-medium leading-relaxed text-ink">
        CoasterRank is a free, open-source leaderboard for roller coasters, built from the rankings
        of the people who ride them.
      </p>

      <div className="mt-8 space-y-10 text-sm leading-7 text-muted">
        <section>
          <h2 className="section-heading mb-3">Our purpose</h2>
          <p>
            Our goal is to turn the community&apos;s collective experience into a useful, shared
            resource: a place to discover coasters, compare favorites, and contribute your own
            perspective throughout the year.
          </p>
          <p className="mt-3">
            Rank the coasters you&apos;ve ridden from best to worst, share your personal list, and
            help shape the public leaderboard. You can browse the community rankings without an
            account, and riders with a handful of coasters are as welcome as lifelong enthusiasts.
          </p>
        </section>

        <section>
          <h2 className="section-heading mb-3">How the ranking works</h2>
          <p>
            Your ordered list provides a set of head-to-head preferences: each coaster is preferred
            to every coaster below it. These comparisons let us combine different riders&apos; lists
            without asking everyone to agree on a rating scale.
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
            (BT) is the statistical model we use to turn those comparisons into a strength score for
            each coaster. It estimates how consistently a coaster is preferred to others, taking
            into account the strength of the coasters it is compared with.
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
              <Tex tex="\Delta < 10^{-8}" />, capped at 500 passes), then multiply by 100 for
              display — 100 is the community average. That&apos;s the whole trick.
            </p>
          </MathDisclosure>

          <p className="mt-3">
            Longer lists contain many more comparisons, so we weight each rider&apos;s contribution
            to balance that effect. Overall influence grows roughly in proportion to the number of
            coasters ranked, rather than the much larger number of pairs. Short lists contribute
            too, with an adjustment that limits the influence of very small samples.
          </p>

          <MathDisclosure label="Show me the weighting">
            <p>
              Your best-to-worst list already contains every head-to-head result — ranking{' '}
              <Tex tex="n" /> coasters settles all of them at once:
            </p>
            <Formula
              tex={
                '\\begin{aligned}\n&\\text{a list of } n \\text{ coasters} \\\\[2pt]\n&\\quad\\Longrightarrow\\quad P = \\tfrac{n(n-1)}{2} \\text{ head-to-heads}\n\\end{aligned}'
              }
            />
            <p className="mt-4">
              Each head-to-head you cast is weighted by the size of your list, with a small phantom
              floor (about an 8-coaster list&apos;s worth) so very short lists carry limited weight:
            </p>
            <Formula
              tex={
                '\\begin{aligned}\nw &= \\frac{1}{\\sqrt{\\,P + 28\\,}} \\\\[2pt]\n&\\Longrightarrow\\quad \\text{total say} \\;\\approx\\; \\sqrt{P} \\;\\propto\\; n\n\\end{aligned}'
              }
            />
            <p className="mt-4">
              Rank five coasters or five hundred — your say keeps growing with your list, and no
              single opinion ever outweighs the whole community.
            </p>
          </MathDisclosure>

          <p className="mt-3">
            The board is recalculated regularly as riders update their lists. Scores are shown on an
            index where 100 is the community average — anything above it was preferred more often.
            Results with fewer comparisons are more provisional, so the aim is a useful picture of
            community opinion, with room for different tastes and new perspectives.
          </p>
        </section>

        <section>
          <h2 className="section-heading mb-3">Our commitments</h2>
          <ul className="list-disc space-y-3 pl-5">
            <li>
              <strong className="text-ink">Free access.</strong> Browsing the leaderboard and
              creating your own rankings are free. There are no ads or paid ranking placements.
            </li>
            <li>
              <strong className="text-ink">An open method.</strong> We publish the ranking code and
              explain how contributions are weighted, so anyone can examine the method, question the
              results, or propose improvements.
            </li>
            <li>
              <strong className="text-ink">Respect for your information.</strong> We do not sell
              your personal information. Your rankings and contributions are public; our{' '}
              <Link to="/privacy" className="link-brand">
                privacy policy
              </Link>{' '}
              explains what we collect, how it is used, and your options for managing it.
            </li>
            <li>
              <strong className="text-ink">A shared resource.</strong> The application code is
              MIT-licensed, the seed catalog is public-domain data, and community contributions are
              licensed under CC&nbsp;BY&nbsp;4.0. These licenses let others build on the work, with
              attribution where required.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="section-heading mb-3">Contribute</h2>
          <p>
            CoasterRank is{' '}
            <a
              href="https://github.com/pandeiro/CoasterRank"
              target="_blank"
              rel="noopener noreferrer"
              className="link-brand"
            >
              open source on GitHub
            </a>
            . Code contributions, bug reports, and feedback on the ranking method are welcome. You
            can also help directly through the app:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-ink">Improve the catalog:</strong>{' '}
              <Link to="/submit" className="link-brand">
                submit a missing coaster
              </Link>{' '}
              or suggest a correction from a coaster&apos;s page. Community submissions help keep
              the shared catalog accurate and up to date.
            </li>
            <li>
              <strong className="text-ink">Share your experience:</strong> rank the coasters
              you&apos;ve ridden and update your list as you ride more or your preferences change.
              Your perspective belongs here, whether or not it matches the leaderboard.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="section-heading mb-3">Origins</h2>
          <p>
            CoasterRank grew out of an appreciation for the enthusiast community, including{' '}
            <a
              href="https://aceonline.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="link-brand"
            >
              ACE
            </a>{' '}
            and ranking projects such as{' '}
            <a
              href="https://votecoasters.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="link-brand"
            >
              VoteCoasters
            </a>
            . In that spirit, CoasterRank is a year-round ranking that riders can contribute to
            whenever they choose. The project is maintained by CoasterRank Contributors.
          </p>
        </section>
      </div>

      <div className="mt-10 flex items-center gap-6 border-t border-line pt-6 text-xs">
        <Link to="/faq" className="text-muted underline transition-colors hover:text-ink">
          More questions? Read the FAQ
        </Link>
      </div>
    </div>
  )
}
