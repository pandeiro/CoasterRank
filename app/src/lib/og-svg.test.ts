// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildRiderOgSvg,
  OG_IMAGE_WIDTH,
  OG_IMAGE_HEIGHT,
  topSpotlight,
  type OgSvgProfile,
} from './og-svg'
import { truncate } from './truncate'

function profile(overrides: Partial<OgSvgProfile> = {}): OgSvgProfile {
  return {
    displayName: 'Marina Thrills',
    username: 'marina_thrills',
    memberSinceYear: '2021',
    rankedCount: 47,
    parkCount: 18,
    topPark: { name: 'Cedar Point', count: 9 },
    topManufacturer: { name: 'Bolliger & Mabillard', count: 20 },
    avatarDataUri: null,
    ...overrides,
  }
}

const rides = [
  {
    rank: 1,
    name: 'Steel Vengeance',
    park_name: 'Cedar Point',
    manufacturer_name: 'Rocky Mountain Construction',
    score: null,
  },
  {
    rank: 2,
    name: 'VelociCoaster',
    park_name: 'Universal Islands of Adventure',
    manufacturer_name: 'Intamin',
    score: null,
  },
  {
    rank: 3,
    name: 'Zadra',
    park_name: 'Energylandia',
    manufacturer_name: 'Rocky Mountain Construction',
    score: null,
  },
  {
    rank: 4,
    name: 'El Toro',
    park_name: 'Six Flags Great Adventure',
    manufacturer_name: 'Intamin',
    score: null,
  },
  {
    rank: 5,
    name: 'Pantheon',
    park_name: 'Busch Gardens Williamsburg',
    manufacturer_name: 'Intamin',
    score: null,
  },
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

  it('spotlights the top park and top builder instead of boilerplate', () => {
    const svg = buildRiderOgSvg(profile(), rides)
    expect(svg).toContain('TOP PARK')
    expect(svg).toContain('Cedar Point')
    expect(svg).toContain('TOP BUILDER')
    expect(svg).toContain('Bolliger &amp; Mabillard')
    // Brand is a small mark + domain line now, not the big wordmark or URL footer.
    expect(svg).not.toContain('>Coaster<tspan')
    expect(svg).not.toContain('https://coasterrank.test/riders/marina_thrills')
  })

  it('omits spotlight rows with no data', () => {
    const svg = buildRiderOgSvg(profile({ topPark: null, topManufacturer: null }), [])
    expect(svg).not.toContain('TOP PARK')
    expect(svg).not.toContain('TOP BUILDER')
  })

  it('inlines the real v6 logomark, not abstract bars', () => {
    const svg = buildRiderOgSvg(profile(), rides)
    // Reversed mark: canvas hill, accent wave, coral heart.
    expect(svg).toContain('#FEFCF3')
    expect(svg).toContain('#48CAE4')
    expect(svg).toContain('#E85D75')
    expect(svg).toContain('viewBox="50.9 260.2 1443.9 1113.2"')
    expect(svg).toContain('RIDER RANKING')
  })

  it('escapes user-controlled text', () => {
    const svg = buildRiderOgSvg(
      profile({ displayName: '<script>alert("x")</script>', username: 'evil_user' }),
      [
        {
          rank: 1,
          name: 'A & B <C>',
          park_name: 'P "quoted"',
          manufacturer_name: null,
          score: null,
        },
      ],
    )
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('A &amp; B &lt;C&gt;')
    expect(svg).toContain('P &quot;quoted&quot;')
  })

  it('truncates overlong names instead of overflowing', () => {
    const svg = buildRiderOgSvg(profile({ displayName: 'A'.repeat(60) }), [
      {
        rank: 1,
        name: 'B'.repeat(60),
        park_name: 'C'.repeat(80),
        manufacturer_name: null,
        score: null,
      },
    ])
    expect(svg).not.toContain('A'.repeat(60))
    expect(svg).toContain('…')
  })

  it('caps the list at 5 rides', () => {
    const many = [
      ...rides,
      {
        rank: 6,
        name: 'Sixth Wheel',
        park_name: 'Elsewhere',
        manufacturer_name: null,
        score: null,
      },
    ]
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

  it('keeps a small brand line instead of the big wordmark footer', () => {
    const svg = buildRiderOgSvg(profile(), rides)
    expect(svg).toContain('coasterrank.app')
    expect(svg).not.toContain('https://coasterrank.test/riders/marina_thrills')
  })
})

describe('topSpotlight', () => {
  const spotRides = [
    { rank: 1, name: 'A', park_name: 'Cedar Point', manufacturer_name: 'Intamin', score: null },
    {
      rank: 2,
      name: 'B',
      park_name: 'Cedar Point',
      manufacturer_name: 'Bolliger & Mabillard',
      score: null,
    },
    { rank: 3, name: 'C', park_name: 'Carowinds', manufacturer_name: 'Intamin', score: null },
  ]

  it('picks the most-ridden value with its count', () => {
    expect(topSpotlight(spotRides, 'park_name')).toEqual({ name: 'Cedar Point', count: 2 })
    expect(topSpotlight(spotRides, 'manufacturer_name')).toEqual({ name: 'Intamin', count: 2 })
  })

  it('breaks count ties by average score, then best rank, then name', () => {
    const scored = [
      { rank: 1, name: 'A', park_name: 'Zeta Park', manufacturer_name: 'RMC', score: 1.0 },
      { rank: 2, name: 'B', park_name: 'Alpha Park', manufacturer_name: 'Intamin', score: 3.0 },
      { rank: 3, name: 'C', park_name: 'Alpha Park', manufacturer_name: 'Intamin', score: 3.0 },
      { rank: 4, name: 'D', park_name: 'Zeta Park', manufacturer_name: 'RMC', score: 1.0 },
    ]
    // 2–2 on count; Intamin's avg (3.0) beats RMC's (1.0) despite RMC holding #1.
    expect(topSpotlight(scored, 'manufacturer_name')).toEqual({ name: 'Intamin', count: 2 })
    expect(topSpotlight(scored, 'park_name')).toEqual({ name: 'Alpha Park', count: 2 })
  })

  it('falls back to best rank when neither side is scored', () => {
    const unscored = [
      { rank: 1, name: 'A', park_name: 'Zeta Park', manufacturer_name: null, score: null },
      { rank: 2, name: 'B', park_name: 'Alpha Park', manufacturer_name: null, score: null },
    ]
    expect(topSpotlight(unscored, 'park_name')).toEqual({ name: 'Zeta Park', count: 1 })
  })

  it('uses name only as the final deterministic fallback', () => {
    const identical = [
      { rank: 1, name: 'A', park_name: 'Zeta Park', manufacturer_name: null, score: 2.0 },
      { rank: 1, name: 'B', park_name: 'Alpha Park', manufacturer_name: null, score: 2.0 },
    ]
    expect(topSpotlight(identical, 'park_name')).toEqual({ name: 'Alpha Park', count: 1 })
  })

  it('ignores blank values and returns null when nothing qualifies', () => {
    expect(topSpotlight([], 'park_name')).toBeNull()
    const blanks = [{ rank: 1, name: 'A', park_name: null, manufacturer_name: '  ', score: null }]
    expect(topSpotlight(blanks, 'park_name')).toBeNull()
    expect(topSpotlight(blanks, 'manufacturer_name')).toBeNull()
  })

  it('scopes the pool to the first N rides by rank when limited', () => {
    const many = [
      {
        rank: 3,
        name: 'C',
        park_name: 'Carowinds',
        manufacturer_name: 'Bolliger & Mabillard',
        score: null,
      },
      { rank: 1, name: 'A', park_name: 'Cedar Point', manufacturer_name: 'Intamin', score: null },
      { rank: 2, name: 'B', park_name: 'Cedar Point', manufacturer_name: 'Intamin', score: null },
    ]
    // Unsorted input still ranks by rank: top 2 are both Intamin / Cedar Point.
    expect(topSpotlight(many, 'manufacturer_name', 2)).toEqual({ name: 'Intamin', count: 2 })
    expect(topSpotlight(many, 'park_name', 1)).toEqual({ name: 'Cedar Point', count: 1 })
    expect(topSpotlight(many, 'manufacturer_name')).toEqual({ name: 'Intamin', count: 2 })
  })
})
