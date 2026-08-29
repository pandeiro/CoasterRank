/**
 * Copy a URL to the clipboard with a fallback for older browsers. Returns
 * whether the copy attempt succeeded so callers can show feedback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // navigator.clipboard only exists in secure contexts, so its presence is
    // itself the capability check.
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
