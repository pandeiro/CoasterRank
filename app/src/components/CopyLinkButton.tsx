import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { copyToClipboard } from '../lib/clipboard'
import { Button } from './ui'

export function CopyLinkButton({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const onCopy = useCallback(async () => {
    const ok = await copyToClipboard(url)
    if (ok) {
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    }
  }, [url])

  return (
    <Button type="button" variant="outline" size="sm" onClick={onCopy}>
      {copied ? <Check size={14} className="text-success-text" /> : <Link2 size={14} />}
      {copied ? 'Copied!' : label}
    </Button>
  )
}
