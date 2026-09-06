import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Footer from './Footer'
import ImpersonationBanner from './ImpersonationBanner'
import { useAuth } from '../lib/auth-context'
import { fetchProfile } from '../lib/profile'
import UserMenu from './UserMenu'

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'font-medium text-ink' : 'text-muted transition-colors hover:text-ink'
}

export default function Layout() {
  const { user, isLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isBoard = location.pathname === '/'
  const [scrolledPastHero, setScrolledPastHero] = useState(false)
  // Sign-out failure feedback: signOut() throws instead of navigating, so a
  // failed logout keeps the session (truthful) and explains itself here.
  const [signOutError, setSignOutError] = useState<string | null>(null)
  // The board leads with its own hero; everywhere else the sticky header is
  // the permanent chrome (logo links home to the global ranking).
  const showBrand = !isBoard || scrolledPastHero

  useEffect(() => {
    if (!isBoard) {
      setScrolledPastHero(false)
      return
    }
    let raf = 0
    let observer: IntersectionObserver | null = null
    let hero: Element | null = null

    const handle = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        hero = document.querySelector('[data-board-hero]')
        if (!hero) return
        if (observer) observer.disconnect()
        observer = new IntersectionObserver(
          ([entry]) => {
            // When hero bottom is above the sticky header (~64px), it is no longer intersecting.
            setScrolledPastHero(!entry.isIntersecting)
          },
          { rootMargin: '-64px 0px 0px 0px', threshold: 0 },
        )
        observer.observe(hero)
      })
    }

    handle()
    // Hero mounts after Layout, so observe DOM mutations until it appears.
    const mo = new MutationObserver(handle)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      if (observer) observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [isBoard, location.pathname])

  // Same queryKey as ProfilePage/RequireAdmin, so the fetch is shared; we only
  // need the admin flag here to decide whether to show the Admin link.
  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: () => fetchProfile(user!.id),
  })

  async function onSignOut() {
    setSignOutError(null)
    try {
      await signOut()
    } catch (e) {
      setSignOutError(e instanceof Error ? e.message : 'Sign out failed.')
      return
    }
    navigate('/')
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header
        className={`sticky top-0 z-30 border-b backdrop-blur transition-colors duration-300 ${
          showBrand ? 'border-line/80 bg-canvas/95' : 'border-transparent bg-canvas/0'
        }`}
      >
        <div className="page-container flex min-h-16 items-center justify-between gap-6">
          <Link
            to="/"
            aria-hidden={!showBrand}
            className={`flex shrink-0 items-baseline gap-[0.14rem] text-ink transition-all duration-300 ease-out ${
              showBrand
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none -translate-y-1 opacity-0'
            }`}
          >
            <img
              src="/logo.svg"
              alt=""
              width="1444"
              height="1113"
              fetchPriority="high"
              decoding="async"
              className="h-[2.3rem] w-auto shrink-0"
            />
            <span className="display-heading -translate-y-[0.12em] text-2xl leading-none tracking-wide">
              Coaster<span className="text-coral">Rank</span>
            </span>
          </Link>
          <nav className="flex items-center gap-3 text-sm sm:gap-5">
            {isLoading ? null : user ? (
              <UserMenu profile={profile} userId={user.id} onSignOut={onSignOut} />
            ) : (
              <>
                <NavLink to="/login" className={navLinkClass}>
                  Log in
                </NavLink>
                <Link
                  to="/signup"
                  className="rounded-full bg-ink px-3.5 py-1.5 font-medium text-canvas transition-colors hover:bg-ink-soft"
                >
                  Sign up
                </Link>
              </>
            )}
            {signOutError && (
              <span role="alert" className="text-sm text-danger">
                Couldn&apos;t sign out: {signOutError}
              </span>
            )}
          </nav>
        </div>
      </header>
      {/* NO w-full here: it's a utilities-layer class and would override the
          components-layer .page-container width (width: min(100% - 2rem,
          72rem)), stretching main to the full viewport (the 2026-09-05
          regression). In a column flex container the explicit width wins over
          align-items:stretch, so flex-1 alone pins the footer to the bottom
          on short pages without touching the width. */}
      <main className="page-container flex-1 pt-4 pb-8 sm:pt-6 sm:pb-10">
        <Outlet />
      </main>
      <ImpersonationBanner />
      <Footer />
    </div>
  )
}
