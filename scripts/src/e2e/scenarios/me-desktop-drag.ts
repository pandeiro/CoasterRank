/**
 * Scenario: desktop mouse drag reorder + restore on /me.
 *
 * Run: cd scripts && npm run e2e:desktop-drag
 *
 * Writes: drag reorder upserts the synthetic user's ranks — the scenario
 * drags back to restore. Run only against the synthetic user (see helpers).
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import {
  assertNoHorizontalOverflow,
  captureDiagnostics,
  ensureServer,
  login,
  mouseDragRow,
  rankedNames,
  requireSyntheticUser,
} from '../helpers'

async function main(): Promise<void> {
  await ensureServer()
  await requireSyntheticUser()

  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    const diag = captureDiagnostics(page)

    await login(page)
    const before = await rankedNames(page)
    if (before.length < 5) throw new Error(`need >=5 ranked rows, found ${before.length}`)

    // Drag a middle row down two slots (edge rows can't reorder — there are
    // no droppables beyond them).
    await mouseDragRow(page, 1, 3)
    const after = await rankedNames(page)
    if (after[3] !== before[1]) {
      throw new Error(`drag failed: expected ${before[1]} at #4, got order ${after.slice(0, 5).join(', ')}`)
    }
    console.log('pass: desktop drag moved row down two slots')

    // Restore the exact original order.
    await mouseDragRow(page, 3, 1)
    const restored = await rankedNames(page)
    if (JSON.stringify(restored) !== JSON.stringify(before)) {
      throw new Error(`restore failed:\n  want ${before.join(', ')}\n  got  ${restored.join(', ')}`)
    }
    console.log('pass: order restored')

    await assertNoHorizontalOverflow(page)
    console.log('pass: no horizontal overflow')

    const errors = diag.errors()
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`)
    console.log('pass: no console/page errors')
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
