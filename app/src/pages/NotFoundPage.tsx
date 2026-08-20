import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="py-24 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-slate-400">404</p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-slate-600">That page doesn&apos;t exist or has moved.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
      >
        Back to the board
      </Link>
    </div>
  )
}
