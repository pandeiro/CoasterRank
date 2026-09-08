import { hasChunkReloadGuard } from '../lib/chunk-recovery'

interface ErrorFallbackProps {
  reset?: () => void
}

export default function ErrorFallback({ reset }: ErrorFallbackProps) {
  // A set guard means the stale-chunk auto-reload (lib/chunk-recovery) was
  // already attempted and didn't fix it — talk about the update, not a bug.
  const staleBuild = hasChunkReloadGuard()
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>
        {staleBuild ? 'Update available' : 'Something went wrong'}
      </h1>
      <p style={{ marginBottom: '2rem' }}>
        {staleBuild
          ? 'A new version of CoasterRank was released. Reload to get the update.'
          : 'An unexpected error occurred. Please try reloading the page.'}
      </p>
      <button
        onClick={reset ?? (() => window.location.reload())}
        style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
      >
        Reload Page
      </button>
    </div>
  )
}
