import { useEffect, useRef, useState } from 'react'

type Props = {
  message: string
  onDismiss: () => void
  durationMs?: number
  tone?: 'info' | 'error'
}

export default function Toast({ message, onDismiss, durationMs = 3000, tone = 'info' }: Props) {
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

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm text-white shadow-lg transition-opacity duration-300 ${
        tone === 'error' ? 'bg-red-600' : 'bg-slate-900'
      } ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {message}
    </div>
  )
}
