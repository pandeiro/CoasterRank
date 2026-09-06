/**
 * Render mock rider OG cards to PNG for design review.
 *
 * Uses the SAME production code path as the edge route: app/src/lib/og-svg.ts
 * (SVG builder) + the committed resvg.wasm + brand fonts from
 * app/public/fonts. Output goes to docs/social-preview/rider-og-previews/
 * and is committed for PR review.
 *
 * Usage: cd scripts && npx tsx src/oneoff/render-og-previews.ts
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import { buildRiderOgSvg, type OgSvgProfile, type OgSvgRide } from '../../../app/src/lib/og-svg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const appPublic = join(root, 'app', 'public')
const outDir = join(root, 'docs', 'social-preview', 'rider-og-previews')

type Persona = { file: string; profile: OgSvgProfile; rides: OgSvgRide[] }

async function dataUri(relPath: string, mime: string): Promise<string> {
  const bytes = await readFile(join(appPublic, relPath))
  return `data:${mime};base64,${bytes.toString('base64')}`
}

async function main(): Promise<void> {
  await initWasm(await readFile(join(appPublic, 'resvg.wasm')))
  const fonts = await Promise.all(
    ['fonts/inter-latin.woff2', 'fonts/racing-sans-one-latin.woff2'].map((p) =>
      readFile(join(appPublic, p)),
    ),
  )
  const avatar = await dataUri('apple-touch-icon.png', 'image/png')

  const personas: Persona[] = [
    {
      file: 'power-user-avatar.png',
      profile: {
        displayName: 'Marina Thrills',
        username: 'marina_thrills',
        memberSinceYear: '2021',
        rankedCount: 47,
        parkCount: 18,
        avatarDataUri: avatar,
        pageUrl: 'https://coasterrank.app/riders/marina_thrills',
      },
      rides: [
        { rank: 1, name: 'Steel Vengeance', park_name: 'Cedar Point' },
        { rank: 2, name: 'VelociCoaster', park_name: 'Universal Islands of Adventure' },
        { rank: 3, name: 'Zadra', park_name: 'Energylandia' },
        { rank: 4, name: 'El Toro', park_name: 'Six Flags Great Adventure' },
        { rank: 5, name: 'Pantheon', park_name: 'Busch Gardens Williamsburg' },
      ],
    },
    {
      file: 'long-names.png',
      profile: {
        displayName: 'Alexandrina Thundercoaster-Fitzgerald the Third',
        username: 'alex_thunder',
        memberSinceYear: '2023',
        rankedCount: 128,
        parkCount: 64,
        avatarDataUri: null,
        pageUrl: 'https://coasterrank.app/riders/alex_thunder',
      },
      rides: [
        {
          rank: 1,
          name: 'The Unbelievably Long-Named Hypercoaster of Extreme Destiny: Revenge of the Loop',
          park_name:
            'The Most Magnificent Amusement Park and Resort Destination in the Entire County',
        },
        { rank: 2, name: 'Zadra', park_name: 'Energylandia' },
        { rank: 3, name: 'El Toro', park_name: 'Six Flags Great Adventure' },
        { rank: 4, name: 'Pantheon', park_name: 'Busch Gardens Williamsburg' },
        { rank: 5, name: 'Fury 325', park_name: 'Carowinds' },
      ],
    },
    {
      file: 'casual-3-rides.png',
      profile: {
        displayName: 'Coaster Dad',
        username: 'coaster_dad',
        memberSinceYear: null,
        rankedCount: 3,
        parkCount: 2,
        avatarDataUri: null,
        pageUrl: 'https://coasterrank.app/riders/coaster_dad',
      },
      rides: [
        { rank: 1, name: 'Big Thunder Mountain', park_name: 'Disneyland' },
        { rank: 2, name: 'Space Mountain', park_name: 'Disneyland' },
        { rank: 3, name: 'Matterhorn Bobsleds', park_name: 'Disneyland' },
      ],
    },
    {
      file: 'empty.png',
      profile: {
        displayName: 'New Rider',
        username: 'new_rider',
        memberSinceYear: '2026',
        rankedCount: 0,
        parkCount: 0,
        avatarDataUri: null,
        pageUrl: 'https://coasterrank.app/riders/new_rider',
      },
      rides: [],
    },
    {
      file: 'escaping.png',
      profile: {
        displayName: '<script>alert("x&y")</script>',
        username: 'xss_test',
        memberSinceYear: '2024',
        rankedCount: 2,
        parkCount: 1,
        avatarDataUri: null,
        pageUrl: 'https://coasterrank.app/riders/xss_test',
      },
      rides: [
        { rank: 1, name: 'A & B <C> "D"', park_name: "O'Hare > All" },
        { rank: 2, name: 'Zadra', park_name: 'Energylandia' },
      ],
    },
  ]

  await mkdir(outDir, { recursive: true })
  for (const persona of personas) {
    const svg = buildRiderOgSvg(persona.profile, persona.rides)
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
      font: { fontBuffers: fonts, loadSystemFonts: false },
    })
      .render()
      .asPng()
    const outPath = join(outDir, persona.file)
    await writeFile(outPath, png)
    console.log(`${persona.file}: ${svg.length}b svg → ${png.length}b png`)
  }
}

await main()
