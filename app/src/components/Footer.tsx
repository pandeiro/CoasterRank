import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="border-t border-line/80 bg-canvas/95">
      <div className="page-container flex flex-col items-center gap-3 py-6 text-xs text-muted sm:flex-row sm:justify-between">
        <span>&copy; {new Date().getFullYear()} CoasterRank Contributors</span>
        <nav className="flex items-center gap-4">
          <Link to="/terms" className="transition-colors hover:text-ink">
            Terms
          </Link>
          <Link to="/privacy" className="transition-colors hover:text-ink">
            Privacy
          </Link>
          <a
            href="https://github.com/pandeiro/CoasterRank"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-ink"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  )
}
