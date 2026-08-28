import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LogOut, User, List } from 'lucide-react'
import type { Profile } from '../lib/profile'
import Avatar from './ui/Avatar'

interface UserMenuProps {
  profile: Profile | undefined
  userId: string
  onSignOut: () => void
}

export default function UserMenu({ profile, userId, onSignOut }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const location = useLocation()

  // Close on route change
  useEffect(() => {
    setIsOpen(false)
  }, [location.pathname])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <div className="relative flex items-center" ref={menuRef}>
      {/* Admin pill */}
      {profile?.is_admin && (
        <NavLink
          to="/admin"
          className="mr-3 inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent-strong transition-colors hover:bg-accent/20"
        >
          Admin
        </NavLink>
      )}

      {/* Avatar button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Avatar src={profile?.avatar_url ?? null} userId={userId} size={36} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <div
            className="fixed inset-x-0 top-16 z-50 border-b border-line bg-surface-bright shadow-lg sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-48 sm:rounded-xl sm:border sm:border-line sm:shadow-lift"
            role="menu"
          >
            <div className="flex flex-col py-1">
              <NavLink
                to="/me"
                className="flex items-center gap-3 px-4 py-3 text-sm text-ink transition-colors hover:bg-surface sm:rounded-t-xl"
                role="menuitem"
              >
                <List size={16} className="text-muted" />
                My Coasters
              </NavLink>
              <NavLink
                to="/me/profile"
                className="flex items-center gap-3 px-4 py-3 text-sm text-ink transition-colors hover:bg-surface"
                role="menuitem"
              >
                <User size={16} className="text-muted" />
                Profile
              </NavLink>
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                onClick={onSignOut}
                className="flex items-center gap-3 px-4 py-3 text-sm text-ink transition-colors hover:bg-surface sm:rounded-b-xl"
                role="menuitem"
              >
                <LogOut size={16} className="text-muted" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
