// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildRiderOgSvg, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, type OgSvgProfile } from './og-svg'
import { truncate } from './truncate'

function profile(overrides: Partial<OgSvgProfile> = {}): OgSvgProfile {
  return {
    displayName: 'Marina Thrills',
    username: 'marina_thrills',
    memberSinceYear: '2021',
    rankedCount: 47,
    parkCount: 18,
    avatarDataUri: null,
    pageUrl: 'https://coasterrank.test/riders/marina_thrills',
    ...overrides,
  }
}

const rides = [
  { rank: 1, name: 'Steel Vengeance', park_name: 'Cedar Point' },
  { rank: 2, name: 'VelociCoaster', park_name: 'Universal Islands of Adventure' },
  { rank: 3, name: 'Zadra', park_name: 'Energylandia' },
  { rank: 4, name: 'El Toro', park_name: 'Six Flags Great Adventure' },
  { rank: 5, name: 'Pantheon', park_name: 'Busch Gardens Williamsburg' },
]

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('Zadra', 24)).toBe('Zadra')
  })

  it('ellipsizes long text within the budget', () => {
    expect(truncate('A very long coaster name indeed', 10)).toBe('A very lo…')
    expect([...truncate('A very long coaster name indeed', 10)].length).toBe(10)
  })
})

describe('buildRiderOgSvg', () => {
  it('renders a 1200x630 document with identity, stats, and top 5', () => {
    const svg = buildRiderOgSvg(profile(), rides)
    expect(svg).toContain(`width="${OG_IMAGE_WIDTH}"`)
    expect(svg).toContain(`height="${OG_IMAGE_HEIGHT}"`)
    expect(svg).toContain('Marina Thrills')
    expect(svg).toContain('@marina_thrills')
    expect(svg).toContain('47 RANKED')
    expect(svg).toContain('18 PARKS')
    expect(svg).toContain('SINCE 2021')
    for (const ride of rides) expect(svg).toContain(ride.name)
  })

  it('inlines the real v6 logomark, not abstract bars', () => {
    const svg = buildRiderOgSvg(profile(), rides)
    // Reversed mark: canvas hill, accent wave, coral heart.
    expect(svg).toContain('#FEFCF3')
    expect(svg).toContain('#48CAE4')
    expect(svg).toContain('#E85D75')
    expect(svg).toContain('viewBox="50.9 260.2 1443.9 1113.2"')
    expect(svg).toContain('Coaster<tspan')
  })

  it('escapes user-controlled text', () => {
    const svg = buildRiderOgSvg(
      profile({ displayName: '<script>alert("x")</script>', username: 'evil_user' }),
      [{ rank: 1, name: 'A & B <C>', park_name: 'P "quoted"' }],
    )
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('A &amp; B &lt;C&gt;')
    expect(svg).toContain('P &quot;quoted&quot;')
  })

  it('truncates overlong names instead of overflowing', () => {
    const svg = buildRiderOgSvg(profile({ displayName: 'A'.repeat(60) }), [
      { rank: 1, name: 'B'.repeat(60), park_name: 'C'.repeat(80) },
    ])
    expect(svg).not.toContain('A'.repeat(60))
    expect(svg).toContain('…')
  })

  it('caps the list at 5 rides', () => {
    const many = [...rides, { rank: 6, name: 'Sixth Wheel', park_name: 'Elsewhere' }]
    const svg = buildRiderOgSvg(profile(), many)
    expect(svg).not.toContain('Sixth Wheel')
  })

  it('renders an empty state with no since pill when there is nothing to show', () => {
    const svg = buildRiderOgSvg(profile({ memberSinceYear: null }), [])
    expect(svg).toContain('No coasters ranked yet.')
    expect(svg).not.toContain('SINCE')
  })

  it('embeds the avatar when provided, else an initial placeholder', () => {
    const withAvatar = buildRiderOgSvg(
      profile({ avatarDataUri: 'data:image/png;base64,AAA' }),
      rides,
    )
    expect(withAvatar).toContain('data:image/png;base64,AAA')
    const withoutAvatar = buildRiderOgSvg(profile({ displayName: 'marina' }), rides)
    expect(withoutAvatar).toContain('>M</text>')
  })

  it('renders the canonical page URL as the footer', () => {
    const svg = buildRiderOgSvg(profile(), rides)
    expect(svg).toContain('https://coasterrank.test/riders/marina_thrills')
  })
})
