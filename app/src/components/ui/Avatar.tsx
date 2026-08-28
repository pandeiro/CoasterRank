import { useEffect, useState } from 'react'
import { getAvatarUrl } from '../../lib/avatars'

export interface AvatarProps {
  src: string | null | undefined
  userId: string
  size?: number
  className?: string
}

export default function Avatar({ src, userId, size = 36, className = '' }: AvatarProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const result = getAvatarUrl(src, userId)
    if (typeof result === 'string') {
      setResolvedSrc(result)
    } else {
      result.then((url) => {
        if (!cancelled) setResolvedSrc(url)
      })
    }
    return () => {
      cancelled = true
    }
  }, [src, userId])

  if (!resolvedSrc) {
    return (
      <div
        className={`rounded-full bg-surface ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <img
      src={resolvedSrc}
      alt=""
      width={size}
      height={size}
      className={`rounded-full object-cover ${className}`}
    />
  )
}
