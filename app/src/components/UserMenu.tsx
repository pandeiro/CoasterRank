import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { LogOut, User, List, Share2, type LucideIcon } from 'lucide-react'
import type { Profile } from '../lib/profile'
import Avatar from './ui/Avatar'
import { isCoarsePointer } from '../lib/use-media-query'

interface UserMenuProps {
  profile: Profile | undefined
  userId: string
  onSignOut: () => void
}

// iOS sheet curve: fast departure, long soft landing.
const SHEET_EASE_IN = 'ease-[cubic-bezier(0.32,0.72,0,1)]'

export default function UserMenu({ profile, userId, onSignOut }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  // sm+ dropdown anchor, measured off the trigger in viewport coordinates.
  // The header is sticky, so the rect is stable while open; only resize moves it.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const location = useLocation()

  // Close on route change (no focus return — the new page takes focus).
  useEffect(() => {
    setIsOpen(false)
  }, [location.pathname])

  // Close on ESC, handing focus back to the trigger like a real menu.
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // sm+ anchor measurement. useLayoutEffect so the first open frame is already
  // positioned — no flash from an unpositioned fixed element.
  useLayoutEffect(() => {
    if (!isOpen) return

    function measure() {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setAnchor({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [isOpen])

  // Move focus into the menu when it opens (sheet on touch, dropdown on desktop).
  useEffect(() => {
    if (!isOpen) return
    ;(isCoarsePointer() ? sheetRef : dropdownRef).current?.focus()
  }, [isOpen])

  // Scroll-lock the page behind the mobile sheet. Desktop dropdown stays
  // scroll-through, and coarse-pointer-only avoids scrollbar-layout shift.
  useEffect(() => {
    if (!isOpen || !isCoarsePointer()) return
    const previous = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = previous
    }
  }, [isOpen])

  function closeAndReturnFocus() {
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  const itemDefs: { to: string; label: string; Icon: LucideIcon }[] = [
    { to: '/me', label: 'My Coasters', Icon: List },
    { to: '/me/profile', label: 'Profile', Icon: User },
  ]
  if (profile?.public_list && profile?.username) {
    itemDefs.push({
      to: `/riders/${profile.username}`,
      label: 'Public page',
      Icon: Share2,
    })
  }

  function renderItems(rowClass: string, iconSize: number) {
    return itemDefs.map(({ to, label, Icon }) => (
      <NavLink key={to} to={to} role="menuitem" className={rowClass}>
        <Icon size={iconSize} className="shrink-0 text-muted" />
        {label}
      </NavLink>
    ))
  }

  return (
    <div className="flex items-center">
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
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
        aria-label="Open account menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <Avatar src={profile?.avatar_url ?? null} userId={userId} size={36} />
      </button>

      {createPortal(
        <>
          {/* Backdrop: full viewport, every breakpoint. The menu must live
              outside the header — backdrop-blur makes the header the containing
              block for fixed descendants, which used to clip the mobile
              backdrop to the 64px header strip. */}
          <div
            data-testid="user-menu-backdrop"
            aria-hidden="true"
            onClick={closeAndReturnFocus}
            className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none sm:bg-black/20 ${
              isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          />

          {/* Mobile: bottom sheet */}
          <div
            ref={sheetRef}
            data-testid="account-sheet"
            role="menu"
            tabIndex={-1}
            aria-hidden={!isOpen}
            inert={!isOpen}
            className={`fixed inset-x-0 bottom-0 z-50 overflow-hidden rounded-t-2xl bg-surface-bright shadow-lift outline-none transition-transform sm:hidden motion-reduce:transition-none ${
              isOpen
                ? `translate-y-0 duration-300 ${SHEET_EASE_IN}`
                : 'translate-y-full duration-200 ease-out'
            }`}
          >
            <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-muted/40" />
            <div className="flex flex-col py-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              {renderItems(
                'flex min-h-[52px] items-center gap-3 px-5 text-base text-ink transition-colors hover:bg-surface active:bg-surface',
                18,
              )}
              <div className="my-2 border-t border-line" />
              <button
                type="button"
                role="menuitem"
                onClick={onSignOut}
                className="flex min-h-[52px] w-full items-center gap-3 px-5 text-left text-base text-coral transition-colors hover:bg-surface active:bg-surface"
              >
                <LogOut size={18} className="shrink-0" />
                Sign out
              </button>
            </div>
          </div>

          {/* Desktop: right-anchored dropdown under the avatar */}
          <div
            ref={dropdownRef}
            data-testid="account-dropdown"
            role="menu"
            tabIndex={-1}
            aria-hidden={!isOpen}
            inert={!isOpen}
            style={anchor ?? undefined}
            className={`hidden sm:block fixed z-50 w-48 origin-top-right overflow-hidden rounded-xl border border-line bg-surface-bright py-1 shadow-lift outline-none transition-[opacity,transform] duration-150 motion-reduce:transition-none ${
              isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0 -translate-y-1'
            }`}
          >
            {renderItems(
              'flex items-center gap-3 px-4 py-3 text-sm text-ink transition-colors hover:bg-surface',
              16,
            )}
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              role="menuitem"
              onClick={onSignOut}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-coral transition-colors hover:bg-surface"
            >
              <LogOut size={16} className="shrink-0" />
              Sign out
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
