import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
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

  // Tagline intro: fade in shortly after load, hold ~4s, fade out for good.
  const [showTagline, setShowTagline] = useState(false)
  useEffect(() => {
    const show = setTimeout(() => setShowTagline(true), 400)
    const hide = setTimeout(() => setShowTagline(false), 4400)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
    }
  }, [])

  // Same queryKey as ProfilePage/RequireAdmin, so the fetch is shared; we only
  // need the admin flag here to decide whether to show the Admin link.
  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: () => fetchProfile(user!.id),
  })

  async function onSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/95 backdrop-blur">
        <div className="page-container flex min-h-16 items-center justify-between gap-6">
          <Link to="/" className="flex shrink-0 items-baseline gap-2 text-ink">
            <img src="/logo.svg" alt="" className="h-8 w-8 self-center" />
            <span className="display-heading text-xl tracking-wide">
              Coaster<span className="text-coral">Rank</span>
            </span>
            <span
              aria-hidden="true"
              className={`ml-1 hidden text-sm text-muted opacity-0 transition-opacity duration-500 lg:inline ${
                showTagline ? 'opacity-60' : ''
              }`}
            >
              A live ranking of the world&apos;s roller coasters
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
          </nav>
        </div>
      </header>
      <main className="page-container pt-4 pb-8 sm:pt-6 sm:pb-10">
        <Outlet />
      </main>
      <ImpersonationBanner />
      <Footer />
    </div>
  )
}
