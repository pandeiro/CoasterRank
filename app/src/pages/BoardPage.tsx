import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import BoardSkeleton from '../components/BoardSkeleton'
import CoasterTable from '../components/CoasterTable'
import FilterBar from '../components/FilterBar'
import LiveStatusPopunder from '../components/LiveStatusPopunder'
import MarkModeBanner from '../components/MarkModeBanner'
import MarkModeDock from '../components/MarkModeDock'
import ScrollSentinel from '../components/ScrollSentinel'
import SignupCta from '../components/SignupCta'
import Toast from '../components/Toast'
import { MessageState } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import {
  enterGuestMarkMode,
  exitGuestMarkMode,
  resetGuestSelection,
  toggleGuestRide,
  useGuestRides,
} from '../lib/guest-rides'
import {
  countryOptions,
  filterCoasters,
  filtersFromSearchParams,
  filtersToSearchParams,
  firstPlaceVisibleIds,
  manufacturerOptions,
  PAGE_SIZE,
  useAllCoasters,
  useBoardMeta,
  type RankingFilters,
} from '../lib/coasters'
import { useMovementLinger, useRankTurnover } from '../lib/rankMovement'
import {
  SIGNUP_CTA_ACTIVITY_WINDOW_MS,
  SIGNUP_CTA_ENGAGED_SECONDS,
  SIGNUP_CTA_RETURN_DELAY_MS,
  armSignupCta,
  clearSignupCtaArmed,
  clearSignupCtaDismissed,
  hasScrolledPastMinimum,
  parseCtaPreviewMode,
  persistSignupCtaDismissed,
  readSignupCtaArmed,
  readSignupCtaDismissed,
} from '../lib/signup-cta'

// Real-user visibility gate for the status line (§2.2): below this the count
// stays hidden so an early-stage launch doesn't advertise small numbers.
const USER_COUNT_VISIBILITY_GATE = 50

function StatusPulse({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-4 animate-pulse rounded bg-line/60 ${className}`}
    />
  )
}

export default function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])
  const [capToast, setCapToast] = useState<string | null>(null)

  const coasters = useAllCoasters()
  // Board meta (real/ranked counts + last recompute) comes from the same
  // edge-cached /api/ranking payload as the rankings — no extra RPC.
  // Missing ranked_user_count (deploy skew) degrades to gate-closed.
  const boardMeta = useBoardMeta()

  // Incremental rendering: start with one page, grow as the user scrolls.
  const [page, setPage] = useState(1)

  // A filter change means a fresh view of the list, so restart at page 1.
  useEffect(() => {
    setPage(1)
  }, [filters])

  const rows = coasters.data
  const countries = useMemo(() => countryOptions(rows ?? []), [rows])
  const manufacturers = useMemo(() => manufacturerOptions(rows ?? []), [rows])
  const rankedUserCount = boardMeta.data?.ranked_user_count ?? 0
  const firstPlaceIds = useMemo(
    () => firstPlaceVisibleIds(rows ?? [], rankedUserCount),
    [rows, rankedUserCount],
  )

  const filteredRows = useMemo(() => (rows ? filterCoasters(rows, filters) : []), [rows, filters])

  // Board status line: the whole catalog (not the filtered view), so the
  // headline always describes the full live ranking.
  const coasterCount = rows?.length ?? 0
  const countryCount = useMemo(
    () => new Set((rows ?? []).map((r) => r.park_country).filter(Boolean)).size,
    [rows],
  )

  const visibleRows = filteredRows.slice(0, page * PAGE_SIZE)
  const hasNextPage = visibleRows.length < filteredRows.length
  const userCount = boardMeta.data?.real_user_count ?? null
  const showUserCount = userCount !== null && userCount > USER_COUNT_VISIBILITY_GATE
  const lastRankedAt = boardMeta.data?.last_recomputed_at ?? boardMeta.data?.generated_at ?? null

  // Rank movement (PLAN §11): a turnover is a changed `last_recomputed_at` —
  // the raw pg_cron timestamp, NOT the generated_at fallback above (edge-cache
  // fills change constantly and would fake turnovers). First load only sets
  // the baseline; movement + animations appear only after a live turnover.
  const lastRecomputedAt = boardMeta.data?.last_recomputed_at ?? null
  const turnover = useRankTurnover(rows, lastRecomputedAt)
  // Chips linger ~12s after a turnover, then unmount (see MOVEMENT_LINGER_MS).
  const movement = useMovementLinger(turnover)

  // §8.3: the table slot cross-fades from the skeleton instead of swapping —
  // the table fades in over one paint, the skeleton fades out and unmounts.
  // Only the initial load fades; filter changes never re-trigger it.
  const [tableVisible, setTableVisible] = useState(false)
  const [skeletonGone, setSkeletonGone] = useState(false)

  useEffect(() => {
    if (coasters.isPending) {
      setTableVisible(false)
      setSkeletonGone(false)
      return
    }
    setTableVisible(true)
    const timer = setTimeout(() => setSkeletonGone(true), 350)
    return () => clearTimeout(timer)
  }, [coasters.isPending])

  const onFiltersChange = useCallback(
    (next: RankingFilters) => {
      setSearchParams(filtersToSearchParams(next), { replace: true })
    },
    [setSearchParams],
  )

  const onLoadMore = useCallback(() => {
    if (hasNextPage) setPage((p) => p + 1)
  }, [hasNextPage])

  // Floating signup CTA (logged-out visitors only). Fires once per visitor:
  // ENGAGED dwell (seconds with recent user activity — a background tab can
  // never trip it) AND scroll engagement must both land; dismissal persists
  // in localStorage. Tunables live in lib/signup-cta.ts (?cta=show previews
  // instantly, ?cta=reset clears the dismissed flag).
  const { user, isLoading: authLoading } = useAuth()
  const [ctaDismissed, setCtaDismissed] = useState(readSignupCtaDismissed)
  const [ctaHidden, setCtaHidden] = useState(false)
  const [dwellReady, setDwellReady] = useState(false)
  const [scrollReady, setScrollReady] = useState(false)
  // Last user-activity timestamp. Starts at -Infinity deliberately: the
  // counter only starts on real action, never on page load.
  const lastActivityRef = useRef(Number.NEGATIVE_INFINITY)
  // Return-trip arming, captured on mount: set during an EARLIER board visit
  // in this tab (leaving for a detail page unmounts the board, coming back
  // remounts it). Deliberately not reactive mid-mount — arming this visit
  // must not fast-path this same visit.
  const [returnArmed] = useState(readSignupCtaArmed)
  const [returnReady, setReturnReady] = useState(false)
  // Captured on mount: later filter navigations rebuild the querystring and
  // may drop the param, which must not un-preview a tweaking session.
  const [ctaPreview] = useState(() => parseCtaPreviewMode(searchParams))

  useEffect(() => {
    if (ctaPreview === 'reset') {
      clearSignupCtaDismissed()
      clearSignupCtaArmed()
      setCtaDismissed(false)
    }
  }, [ctaPreview])

  // Scroll engagement doubles as return-trip arming: a visitor who scrolled,
  // left for a detail page, and came back is warm — no re-earning.
  const markScrollEngaged = useCallback(() => {
    setScrollReady(true)
    armSignupCta()
  }, [])

  // Activity listeners: every scroll/pointer/key/touch stamps "now". The
  // initial depth check below deliberately does NOT stamp — mounting is not
  // engagement.
  useEffect(() => {
    if (authLoading || user || ctaDismissed || ctaPreview === 'show') return
    const stamp = () => {
      lastActivityRef.current = Date.now()
    }
    const onScroll = () => {
      stamp()
      if (hasScrolledPastMinimum()) markScrollEngaged()
    }
    if (hasScrolledPastMinimum()) markScrollEngaged()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pointerdown', stamp, { passive: true })
    window.addEventListener('keydown', stamp)
    window.addEventListener('touchstart', stamp, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointerdown', stamp)
      window.removeEventListener('keydown', stamp)
      window.removeEventListener('touchstart', stamp)
    }
  }, [authLoading, user, ctaDismissed, ctaPreview, markScrollEngaged])

  // Engaged-seconds ticker: a 1s tick counts only while activity happened
  // within the recency window. Stops once the gate trips.
  useEffect(() => {
    if (authLoading || user || ctaDismissed || ctaPreview === 'show' || dwellReady) return
    let engaged = 0
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current <= SIGNUP_CTA_ACTIVITY_WINDOW_MS) {
        engaged += 1
        if (engaged >= SIGNUP_CTA_ENGAGED_SECONDS) setDwellReady(true)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [authLoading, user, ctaDismissed, ctaPreview, dwellReady])

  // Reaching a second page of the board counts as scroll engagement.
  useEffect(() => {
    if (page >= 2) markScrollEngaged()
  }, [page, markScrollEngaged])

  // Return-trip fast path: armed on an earlier board visit in this tab, the
  // card appears after a short settle delay — no re-earning the gates.
  // Dismissal still wins; preview-show bypasses everything as before.
  useEffect(() => {
    if (!returnArmed || authLoading || user || ctaDismissed || ctaPreview === 'show') return
    const timer = setTimeout(() => setReturnReady(true), SIGNUP_CTA_RETURN_DELAY_MS)
    return () => clearTimeout(timer)
  }, [returnArmed, authLoading, user, ctaDismissed, ctaPreview])

  const handleCtaDismiss = useCallback(() => {
    // Preview mode never writes storage — it hides for this view only.
    if (ctaPreview !== 'show') {
      persistSignupCtaDismissed()
      setCtaDismissed(true)
    }
    setCtaHidden(true)
  }, [ctaPreview])

  // ── Mark Mode (GUEST_UX.md §3.2, guest-only in Phase 1–3; Mode 6 fast-add
  // for authed users lands with the Phase 4 RPC). The ?mark=1 param is the
  // cross-page entry (header CTA, /rank back-links); the store keeps the
  // mode + selection across navigation, the param keeps it across reloads.
  const guest = useGuestRides()
  const markMode = !authLoading && !user && guest.markMode
  const markParam = searchParams.get('mark') === '1'

  useEffect(() => {
    if (markParam && !authLoading && !user) enterGuestMarkMode()
  }, [markParam, authLoading, user])

  useEffect(() => {
    if (markMode === markParam) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (markMode) next.set('mark', '1')
        else next.delete('mark')
        return next
      },
      { replace: true },
    )
  }, [markMode, markParam, setSearchParams])

  const handleToggleSelect = useCallback((row: Parameters<typeof toggleGuestRide>[0]) => {
    const result = toggleGuestRide(row)
    if (result === 'capped') {
      setCapToast('You can rank up to 100 coasters as a guest — sign up to go beyond that.')
    }
  }, [])

  const handleMarkExit = useCallback(() => {
    exitGuestMarkMode()
  }, [])

  const handleMarkClear = useCallback(() => {
    resetGuestSelection()
  }, [])

  // CTA card → Mark Mode on the board (§3.1): engage without persisting a
  // dismissal — Mark Mode suppression hides the card for this engagement.
  const handleMarkEnter = useCallback(() => {
    enterGuestMarkMode()
    setCtaHidden(true)
  }, [])

  const handleMarkRank = useCallback(() => {
    navigate('/rank')
  }, [navigate])

  const showCta =
    !authLoading &&
    !user &&
    !markMode &&
    !ctaHidden &&
    (ctaPreview === 'show' || (!ctaDismissed && ((dwellReady && scrollReady) || returnReady)))

  return (
    <>
      <Helmet>
        <title>CoasterRank — A live ranking of the world’s roller coasters</title>
        <meta
          name="description"
          content="CoasterRank is a live, community-voted ranking of the world's roller coasters. Rank the coasters you've ridden and see how they stack up."
        />
        <link rel="canonical" href={`${window.location.origin}/`} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="CoasterRank" />
        <meta
          property="og:title"
          content="CoasterRank — A live ranking of the world’s roller coasters"
        />
        <meta
          property="og:description"
          content="Rank the coasters you've ridden and get your own shareable ranking page. Live community board computed with a Bradley-Terry model."
        />
        <meta property="og:url" content={`${window.location.origin}/`} />
        <meta property="og:image" content={`${window.location.origin}/og-default.png`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="CoasterRank — A live ranking of the world’s roller coasters"
        />
        <meta
          name="twitter:description"
          content="Rank the coasters you've ridden and get your own shareable ranking page. Live community board computed with a Bradley-Terry model."
        />
        <meta name="twitter:image" content={`${window.location.origin}/og-default.png`} />
      </Helmet>
      {/* WebSite entity for crawlers that execute JS (Google indexes
          client-rendered JSON-LD; the bot-only worker prerender carries the
          ItemList instead — see renderHomeHtml in worker.ts). */}
      <script type="application/ld+json">
        {JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'CoasterRank',
          url: `${window.location.origin}/`,
          description:
            "A live, community-voted ranking of the world's roller coasters, scored with a Bradley-Terry model.",
        })}
      </script>
      <header data-board-hero className="relative min-h-[5.5rem] pb-3 sm:pb-4">
        {/* Masthead: lockup + status line. Mobile (§2.4) centers the lockup
            and drops the status line onto its own right-aligned row (the
            line is w-full, so it wraps by itself); desktop keeps brand left
            / line right. The line always renders (§8.1) — while data loads
            it shows pulse bars sized to cover every segment, including the
            gated users count and the About link, so nothing shifts on fill.
            Lockup: mark + wordmark scaled ~12% over the #124 spec, wordmark
            still on the -0.12em optical rise. */}
        <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="mx-auto flex flex-wrap items-baseline justify-center gap-x-1 sm:mx-0 sm:justify-start">
            <img
              src="/logo.svg"
              alt=""
              width="1444"
              height="1113"
              fetchPriority="high"
              decoding="async"
              className="h-[3.7rem] w-auto sm:h-[4.5rem]"
            />
            <span className="display-heading -translate-y-[0.12em] text-[2.4rem] leading-none tracking-wide sm:text-[2.9rem]">
              Coaster<span className="text-coral">Rank</span>
            </span>
          </h1>
          <p className="flex min-h-6 w-full flex-wrap items-center justify-center gap-2 text-sm text-muted sm:w-auto sm:justify-end">
            {rows ? (
              <>
                <Link
                  to="/about"
                  className="font-medium text-ink underline-offset-4 hover:text-accent-text hover:underline"
                >
                  About
                </Link>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {coasterCount.toLocaleString()} coaster{coasterCount === 1 ? '' : 's'}
                </span>
                {countryCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {countryCount} countr{countryCount === 1 ? 'y' : 'ies'}
                    </span>
                  </>
                )}
                {/* Users count is desktop-only: on mobile the line is tight
                    and the count adds little (§2.2 gate still applies). */}
                {showUserCount && (
                  <>
                    <span aria-hidden="true" className="hidden sm:inline">
                      ·
                    </span>
                    <span className="hidden tabular-nums sm:inline">
                      {(userCount ?? 0).toLocaleString()} users
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <LiveStatusPopunder lastRankedAt={lastRankedAt} turnoverId={turnover.turnoverId} />
              </>
            ) : (
              <>
                <StatusPulse className="w-[6.5rem]" />
                <StatusPulse className="w-20" />
                <StatusPulse className="w-16" />
                {/* Users is desktop-only (see above): its pulse hides with it. */}
                <span
                  aria-hidden="true"
                  className="hidden h-4 w-14 animate-pulse rounded bg-line/60 sm:inline-block"
                />
                <StatusPulse className="w-12" />
              </>
            )}
          </p>
        </div>
      </header>
      {markMode && <MarkModeBanner selectedCount={guest.count} onExit={handleMarkExit} />}
      <FilterBar
        filters={filters}
        onChange={onFiltersChange}
        countries={countries}
        manufacturers={manufacturers}
      />
      <div className="relative mt-4 min-h-[60vh] sm:mt-6 sm:min-h-[65vh]">
        {coasters.isError ? (
          <MessageState tone="danger">Couldn&apos;t load the board.</MessageState>
        ) : (
          <>
            {!skeletonGone && (
              <div
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 transition-opacity duration-300 ${
                  tableVisible ? 'pointer-events-none opacity-0' : 'opacity-100'
                }`}
              >
                <BoardSkeleton />
              </div>
            )}
            {!coasters.isPending && (
              <div
                className={`transition-opacity duration-300 ${tableVisible ? 'opacity-100' : 'opacity-0'}`}
              >
                <CoasterTable
                  rows={visibleRows}
                  firstPlaceIds={firstPlaceIds}
                  variant="board"
                  turnover={{ movement, turnoverId: turnover.turnoverId }}
                  selectionMode={markMode}
                  selectedIds={guest.selectedIds}
                  onToggleSelect={handleToggleSelect}
                />
                <ScrollSentinel onLoadMore={onLoadMore} enabled={hasNextPage} />
                {!hasNextPage && visibleRows.length > 0 && (
                  <p className="py-8 text-center text-xs uppercase tracking-[0.12em] text-muted">
                    End of list
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {showCta && <SignupCta onDismiss={handleCtaDismiss} onRankMyRides={handleMarkEnter} />}
      {markMode && guest.count > 0 && (
        <MarkModeDock
          selectedCount={guest.count}
          onRank={handleMarkRank}
          onClear={handleMarkClear}
        />
      )}
      {capToast && (
        <Toast
          message={capToast}
          tone="info"
          durationMs={6000}
          onDismiss={() => setCapToast(null)}
        />
      )}
    </>
  )
}
