interface ErrorFallbackProps {
  reset?: () => void
}

export default function ErrorFallback({ reset }: ErrorFallbackProps) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Something went wrong</h1>
      <p style={{ marginBottom: '2rem' }}>
        An unexpected error occurred. Please try reloading the page.
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
