import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'font-medium text-slate-900' : 'text-slate-600 hover:text-slate-900'
}

export default function Layout() {
  const { user, isLoading, signOut } = useAuth()
  const navigate = useNavigate()

  async function onSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between p-4">
          <Link to="/" className="text-lg font-semibold text-slate-900">
            CoasterRank
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {isLoading ? null : user ? (
              <>
                <NavLink to="/me" className={navLinkClass}>
                  My Coasters
                </NavLink>
                <NavLink to="/me/profile" className={navLinkClass}>
                  Profile
                </NavLink>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="text-slate-600 hover:text-slate-900"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={navLinkClass}>
                  Log in
                </NavLink>
                <Link
                  to="/signup"
                  className="rounded bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-8">
        <Outlet />
      </main>
    </div>
  )
}
