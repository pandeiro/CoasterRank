import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { RankBadge } from '../components/CoasterTable'
import { MessageState, PageHeader, Panel } from '../components/ui'
import { MANUFACTURER_ABBREVIATIONS } from '../lib/abbreviations'
import { lineageNames, useAllCoasters } from '../lib/coasters'
import { buildCountryStandings, type CountryStanding } from '../lib/countries'
import { asFiniteNumber } from '../lib/rankMovement'

const META_TITLE = 'Countries — CoasterRank'
const META_DESCRIPTION =
  'Every country on CoasterRank, ordered by the average global rank of its top five coasters. A fun client-side mashup of the live board.'

function CountryCard({ standing, position }: { standing: CountryStanding; position: number }) {
  // Bleed matches the board table: edge-to-edge band on mobile, floating
  // card restored at sm+.
  return (
    <Panel bleed className="p-4 sm:p-5">
      <div className="flex items-baseline gap-2">
        <span className="display-heading text-sm tabular-nums text-muted">#{position}</span>
        <h2 className="display-heading min-w-0 flex-1 truncate text-xl text-ink">
          {standing.country}
        </h2>
      </div>
      <p className="mt-1 text-sm tabular-nums text-muted/80">
        {standing.totalCoasters.toLocaleString()} coaster
        {standing.totalCoasters === 1 ? '' : 's'} · {standing.rankedCoasters.toLocaleString()}{' '}
        ranked
      </p>
      <ol className="mt-3 divide-y divide-line/70 border-t border-line/70">
        {standing.topFive.map((row) => {
          const rank = asFiniteNumber(row.rank)
          // Primary builder, enthusiast-standard abbreviation with the full
          // name on hover (same convention as the board's manufacturer column).
          const primary = lineageNames(row)[0] ?? null
          const maker = primary ? (MANUFACTURER_ABBREVIATIONS[primary] ?? primary) : null
          return (
            <li key={row.id} className="flex items-center gap-2.5 py-2">
              <span className="flex w-10 shrink-0 items-center justify-center self-center">
                {rank === null ? (
                  <span className="text-base text-muted">—</span>
                ) : (
                  <RankBadge position={rank} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/coasters/${row.slug}`}
                  className="block truncate font-semibold text-ink underline-offset-4 hover:text-accent-text hover:underline"
                >
                  {row.name}
                </Link>
                {row.park_name &&
                  (row.park_slug ? (
                    <Link
                      to={`/parks/${row.park_slug}`}
                      className="block truncate text-sm text-muted hover:underline"
                    >
                      {row.park_name}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm text-muted">{row.park_name}</span>
                  ))}
              </div>
              <span
                className="max-w-24 shrink-0 self-center truncate text-right text-xs text-muted"
                title={maker && primary && maker !== primary ? primary : undefined}
              >
                {maker ?? '—'}
              </span>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

function CountriesSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }, (_, index) => (
        <Panel bleed key={index} className="space-y-3 p-4 sm:p-5">
          <div className="h-6 w-2/3 animate-pulse rounded bg-line/60" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-line/60" />
          {Array.from({ length: 5 }, (_, row) => (
            <div key={row} className="flex items-center gap-2.5">
              <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-line/60" />
              <span className="h-4 min-w-0 flex-1 animate-pulse rounded bg-line/60" />
              <span className="h-4 w-12 shrink-0 animate-pulse rounded bg-line/60" />
            </div>
          ))}
        </Panel>
      ))}
    </div>
  )
}

export default function CountriesPage() {
  const coasters = useAllCoasters()
  const standings = useMemo(() => buildCountryStandings(coasters.data ?? []), [coasters.data])
  const pageUrl = `${window.location.origin}/countries`

  return (
    <div className="py-8">
      <Helmet>
        <title>{META_TITLE}</title>
        <meta name="description" content={META_DESCRIPTION} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="CoasterRank" />
        <meta property="og:title" content={META_TITLE} />
        <meta property="og:description" content={META_DESCRIPTION} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:image" content={`${window.location.origin}/og-default.png`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={META_TITLE} />
        <meta name="twitter:description" content={META_DESCRIPTION} />
        <meta name="twitter:image" content={`${window.location.origin}/og-default.png`} />
      </Helmet>
      <PageHeader
        title="Countries"
        description="Ordered by the average global rank of its top five coasters."
      />
      <div className="mt-6">
        {coasters.isError ? (
          <MessageState tone="danger">Couldn&apos;t load the country standings.</MessageState>
        ) : coasters.isPending ? (
          <CountriesSkeleton />
        ) : standings.length === 0 ? (
          <MessageState>No ranked coasters yet — rank some rides and check back.</MessageState>
        ) : (
          <>
            {/* Explicit single column on mobile: an implicit auto track sizes
                to the rows' nowrap max-content (truncate) and blows the page
                ~40px past the viewport. minmax(0,1fr) caps it; min-w-0 lets
                each card shrink so truncation engages. */}
            <ol className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
              {standings.map((standing, index) => (
                <li key={standing.country} className="min-w-0">
                  <CountryCard standing={standing} position={index + 1} />
                </li>
              ))}
            </ol>
            <p className="mt-8 text-center text-xs leading-5 text-muted">
              Averages run over five slots per country: a bench short of five is padded with ghost
              entries ranked one past the last ranked ride on the board. Ranks and scores update
              with every recompute.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
