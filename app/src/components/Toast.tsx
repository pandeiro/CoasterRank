import { useEffect, useRef, useState } from 'react'

type Props = {
  message: string
  onDismiss: () => void
  durationMs?: number
  tone?: 'info' | 'error'
  action?: { label: string; onClick: () => void }
}

export default function Toast({
  message,
  onDismiss,
  durationMs = 3000,
  tone = 'info',
  action,
}: Props) {
  const [visible, setVisible] = useState(true)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    setVisible(true)
    let dismissId: ReturnType<typeof setTimeout> | undefined
    const fadeId = setTimeout(() => {
      setVisible(false)
      dismissId = setTimeout(() => onDismissRef.current(), 300)
    }, durationMs)
    return () => {
      clearTimeout(fadeId)
      if (dismissId) clearTimeout(dismissId)
    }
  }, [durationMs, message])

  function handleAction() {
    action?.onClick()
    setVisible(false)
    setTimeout(() => onDismissRef.current(), 200)
  }

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full py-2 pl-4 pr-2 text-sm text-white shadow-lg transition-opacity duration-300 ${
        tone === 'error' ? 'bg-danger' : 'bg-ink'
      } ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <span>{message}</span>
      {action && (
        <button
          type="button"
          onClick={handleAction}
          className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/25"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
