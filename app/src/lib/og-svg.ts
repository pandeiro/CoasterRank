import { OG_MARK_INNER, OG_MARK_VIEWBOX } from './og-mark'
import { truncate } from './truncate'

/**
 * Dynamic rider OG card (1200x630) as a standalone SVG string.
 *
 * Pure and DOM-free: the Cloudflare Worker builds this SVG from the public
 * rider RPC payload and rasterizes it to PNG with resvg-wasm
 * (see ../worker.ts og.png route). The same builder drives the committed
 * preview renders under docs/social-preview/rider-og-previews/.
 *
 * Brand tokens mirror app/src/index.css. The logomark is the real v6 artwork
 * (og-mark.ts, extracted from public/logo-reversed.svg — hill in canvas for
 * the dark surface, accent wave, coral heart), NOT the abstract bars motif
 * the old client-side canvas card used.
 */

export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630

const INK = '#1A1A2E'
const CANVAS = '#FEFCF3'
const ACCENT = '#48CAE4'
const CORAL = '#E85D75'
const MUTED = '#74748A'
const CARD_LINE = '#ECE6DA'
const CARD_SUBTLE = '#FAF7EC'
const DISPLAY_FONT = "'Racing Sans One', Arial, sans-serif"
const BODY_FONT = 'Inter, system-ui, sans-serif'

export type OgSvgRide = {
  rank: number
  name: string
  park_name: string | null
  manufacturer_name: string | null
}

export type OgSpotlight = { name: string; count: number } | null

/**
 * Most-ridden value for a ride field (top park / top builder). Count desc,
 * name asc for deterministic ties; blank values ignored. Null when no ride
 * carries the field (empty lists, unknown parks/manufacturers).
 *
 * `limit` scopes the pool to the first N rides by rank — the top-builder
 * spotlight uses 10 so it reflects preference (what you rank highest), not
 * volume (what you happen to have ridden most of).
 */
export function topSpotlight(
  rides: OgSvgRide[],
  key: 'park_name' | 'manufacturer_name',
  limit?: number,
): OgSpotlight {
  const ordered = [...rides].sort((a, b) => a.rank - b.rank)
  const pool = limit === undefined ? ordered : ordered.slice(0, limit)
  const counts = new Map<string, number>()
  for (const ride of pool) {
    const value = ride[key]?.trim()
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  let best: { name: string; count: number } | null = null
  for (const [name, count] of counts) {
    if (!best || count > best.count || (count === best.count && name < best.name)) {
      best = { name, count }
    }
  }
  return best
}

export type OgSvgProfile = {
  displayName: string
  username: string
  /** Four-digit year or null when unknown. */
  memberSinceYear: string | null
  rankedCount: number
  parkCount: number
  /** Most-ridden park / builder (with ride counts), null when none. */
  topPark: OgSpotlight
  topManufacturer: OgSpotlight
  /** data: URI (png/jpeg) or null → initial-letter placeholder. */
  avatarDataUri: string | null
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function pill(label: string, x: number, fill: string, stroke: string, text: string): string {
  // Heuristic width: 20px Inter bold ≈ 12px per char + 40px padding.
  const width = Math.max(64, [...label].length * 12 + 40)
  return `<g>
    <rect x="${x}" y="352" width="${width}" height="44" rx="22" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
    <text x="${x + width / 2}" y="381" text-anchor="middle" font-family="${BODY_FONT}" font-size="20" font-weight="700" letter-spacing="1" fill="${text}">${xmlEscape(label)}</text>
  </g>`
}

function avatarBlock(profile: OgSvgProfile): string {
  const cx = 132
  const cy = 252
  const r = 68
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ACCENT}" stroke-width="5"/>`
  if (profile.avatarDataUri) {
    return `<g>
      <clipPath id="og-avatar"><circle cx="${cx}" cy="${cy}" r="${r - 3}"/></clipPath>
      <image href="${profile.avatarDataUri}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#og-avatar)" preserveAspectRatio="xMidYMid slice"/>
      ${ring}
    </g>`
  }
  const initial = xmlEscape(([...profile.displayName.trim()][0] ?? '?').toUpperCase())
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#2A2A44"/>
    <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-family="${DISPLAY_FONT}" font-size="64" fill="${CANVAS}">${initial}</text>
    ${ring}
  </g>`
}

function topFiveCard(rides: OgSvgRide[], username: string): string {
  const x = 748
  const y = 48
  const w = 388
  const h = 534
  const top = rides.slice(0, 5)

  const rows =
    top.length === 0
      ? `<text x="${x + w / 2}" y="${y + 300}" text-anchor="middle" font-family="${BODY_FONT}" font-size="22" fill="${MUTED}">No coasters ranked yet.</text>`
      : top
          .map((ride, i) => {
            const rowY = y + 128 + i * 82
            const isFirst = ride.rank === 1
            const rankColor = isFirst ? CORAL : 'rgba(26,26,46,0.32)'
            const name = xmlEscape(truncate(ride.name, 20))
            const park = ride.park_name ? xmlEscape(truncate(ride.park_name, 26)) : ''
            const divider =
              i < top.length - 1
                ? `<line x1="${x + 28}" y1="${rowY + 30}" x2="${x + w - 28}" y2="${rowY + 30}" stroke="${CARD_LINE}" stroke-width="1.5"/>`
                : ''
            return `<g>
              <text x="${x + 28}" y="${rowY}" font-family="${DISPLAY_FONT}" font-size="30" fill="${rankColor}">#${ride.rank}</text>
              <text x="${x + 92}" y="${rowY - 2}" font-family="${BODY_FONT}" font-size="23" font-weight="700" fill="${INK}">${name}</text>
              ${park ? `<text x="${x + 92}" y="${rowY + 22}" font-family="${BODY_FONT}" font-size="16" fill="${MUTED}">${park}</text>` : ''}
              ${divider}
            </g>`
          })
          .join('\n')

  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="${CANVAS}"/>
    <rect x="${x}" y="${y}" width="${w}" height="64" rx="20" fill="${INK}"/>
    <rect x="${x}" y="${y + 44}" width="${w}" height="20" fill="${INK}"/>
    <circle cx="${x + 34}" cy="${y + 32}" r="8" fill="${CORAL}"/>
    <text x="${x + 54}" y="${y + 40}" font-family="${BODY_FONT}" font-size="17" font-weight="700" letter-spacing="2.5" fill="rgba(254,252,243,0.75)">TOP 5 · <tspan fill="${ACCENT}">@${xmlEscape(truncate(username, 18))}</tspan></text>
    ${rows}
    <rect x="${x}" y="${y + h - 56}" width="${w}" height="56" rx="20" fill="${CARD_SUBTLE}"/>
    <rect x="${x}" y="${y + h - 56}" width="${w}" height="36" fill="${CARD_SUBTLE}"/>
    <text x="${x + 28}" y="${y + h - 21}" font-family="${BODY_FONT}" font-size="15" font-weight="700" letter-spacing="1.5" fill="#127F99">LIVE RANKING</text>
  </g>`
}

/** Top-park / top-builder spotlight lines under the pills. Null rows omitted. */
function spotlightBlock(profile: OgSvgProfile): string {
  const rows: Array<[string, { name: string; count: number }]> = []
  if (profile.topPark) rows.push(['TOP PARK', profile.topPark])
  if (profile.topManufacturer) rows.push(['TOP BUILDER', profile.topManufacturer])
  return rows
    .map(([label, spot], i) => {
      const y = 452 + i * 64
      const name = xmlEscape(truncate(spot.name, 30))
      const rides = spot.count === 1 ? '1 ridden' : `${spot.count} ridden`
      return `<g>
    <text x="64" y="${y}" font-family="${BODY_FONT}" font-size="14" font-weight="700" letter-spacing="3" fill="rgba(254,252,243,0.5)">${label}</text>
    <text x="64" y="${y + 32}" font-family="${BODY_FONT}" font-size="25" font-weight="700" fill="${CANVAS}">${name}<tspan font-weight="400" font-size="20" fill="${ACCENT}"> · ${rides}</tspan></text>
  </g>`
    })
    .join('\n')
}

/** Builds the full 1200x630 SVG document for a rider card. */
export function buildRiderOgSvg(profile: OgSvgProfile, rides: OgSvgRide[]): string {
  // Racing Sans One is very wide (~30px/char at 62px); the name must clear
  // the top-5 card at x=748, so it stays short and large rather than long.
  const displayName = truncate(profile.displayName.trim() || profile.username, 16)
  const pills: string[] = []
  let px = 64
  const defs: Array<[string, string, string, string]> = [
    [`${profile.rankedCount} RANKED`, 'rgba(232,93,117,0.15)', 'rgba(232,93,117,0.45)', CORAL],
    [`${profile.parkCount} PARKS`, 'rgba(72,202,228,0.14)', 'rgba(72,202,228,0.45)', ACCENT],
  ]
  if (profile.memberSinceYear) {
    defs.push([
      `SINCE ${profile.memberSinceYear}`,
      'transparent',
      'rgba(254,252,243,0.25)',
      'rgba(254,252,243,0.6)',
    ])
  }
  for (const [label, fill, stroke, text] of defs) {
    const width = Math.max(64, [...label].length * 12 + 40)
    pills.push(pill(label, px, fill, stroke, text))
    px += width + 14
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" viewBox="0 0 ${OG_IMAGE_WIDTH} ${OG_IMAGE_HEIGHT}">
  <rect width="${OG_IMAGE_WIDTH}" height="${OG_IMAGE_HEIGHT}" fill="${INK}"/>
  <g opacity="0.08">
    <rect x="880" y="420" width="66" height="140" rx="4" fill="${ACCENT}"/>
    <rect x="962" y="380" width="66" height="180" rx="4" fill="${ACCENT}"/>
    <rect x="1044" y="332" width="66" height="228" rx="4" fill="${ACCENT}"/>
    <rect x="1126" y="276" width="66" height="284" rx="4" fill="${ACCENT}"/>
    <rect x="1208" y="210" width="66" height="350" rx="4" fill="${ACCENT}"/>
    <rect x="1290" y="142" width="66" height="418" rx="4" fill="${ACCENT}"/>
  </g>
  <svg x="64" y="48" width="88" height="68" viewBox="${OG_MARK_VIEWBOX}">${OG_MARK_INNER}</svg>
  <text x="168" y="88" font-family="${BODY_FONT}" font-size="16" font-weight="700" letter-spacing="3" fill="${ACCENT}">RIDER RANKING</text>
  <text x="168" y="112" font-family="${BODY_FONT}" font-size="15" fill="rgba(254,252,243,0.45)">coasterrank.app</text>
  ${avatarBlock(profile)}
  <text x="220" y="258" font-family="${DISPLAY_FONT}" font-size="58" fill="${CANVAS}">${xmlEscape(displayName)}</text>
  <text x="222" y="304" font-family="${BODY_FONT}" font-size="26" fill="${ACCENT}">@${xmlEscape(profile.username)}</text>
  ${pills.join('\n')}
  ${spotlightBlock(profile)}
  ${topFiveCard(rides, profile.username)}
</svg>`
}
