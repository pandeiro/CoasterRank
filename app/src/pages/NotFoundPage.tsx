import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent-strong">404</p>
      <h1 className="display-heading mt-2 text-4xl text-ink">Page not found</h1>
      <p className="mt-2 text-muted">That page doesn&apos;t exist or has moved.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-canvas transition-colors hover:bg-ink-soft"
      >
        Back to the board
      </Link>
    </div>
  )
}
