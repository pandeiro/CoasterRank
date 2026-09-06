/**
 * Truncate to maxChars code points, budgeting the ellipsis inside the limit.
 * Pure string helper shared by the OG SVG builder, worker meta text, and the
 * human rider page — kept in its own module so client imports never pull in
 * the 11KB logomark artwork bundled with og-svg.ts.
 */
export function truncate(text: string, maxChars: number): string {
  const chars = [...text]
  if (chars.length <= maxChars) return text
  if (maxChars <= 1) return '…'
  return `${chars.slice(0, maxChars - 1).join('')}…`
}
