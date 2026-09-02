/**
 * Scenario: touch-context QA on /me — overflow, tiered search, blur-on-select,
 * and long-press drag via the handle.
 *
 * Run: cd scripts && npm run e2e:touch
 *
 * Writes: the long-press drag upserts the synthetic user's ranks — the
 * scenario drags back to restore. On branches with instant-add (#103+) the
 * scenario removes the added coaster again (undo + expiring window) so it
 * leaves zero net writes.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium } from 'playwright'
import {
  assertNoHorizontalOverflow,
  captureDiagnostics,
  dragHandleCenter,
  ensureServer,
  launchTouchContext,
  login,
  longPressDrag,
  rankedNames,
  requireSyntheticUser,
  rowPitch,
} from '../helpers'

async function main(): Promise<void> {
  await ensureServer()
  await requireSyntheticUser()

  const browser = await chromium.launch()
  try {
    const ctx = await launchTouchContext(browser)
    const page = await ctx.newPage()
    const diag = captureDiagnostics(page)

    await login(page)
    await assertNoHorizontalOverflow(page)
    console.log('pass: no horizontal overflow at 375px')

    // Tiered search: "silver" must surface NAME matches ahead of park-name
    // matches (which one name match wins is board order — BT scores move).
    await page.click('input[type="search"]')
    await page.fill('input[type="search"]', 'silver')
    await page.waitForTimeout(700) // 200ms debounce + render
    const firstOption = page.locator('[role="option"]').first()
    const label = (await firstOption.innerText()).replace(/\n/g, ' / ')
    const firstName = label.split(' / ')[0] ?? ''
    if (!/^silver/i.test(firstName)) {
      throw new Error(`tiered search: expected a name match first for "silver", got "${label}"`)
    }
    console.log(`pass: tiered search ranks a name match first ("${firstName}")`)

    // Selecting must blur the input on touch so the keyboard would dismiss.
    const before = await rankedNames(page)
    await firstOption.click()
    await page.waitForTimeout(600)
    const active = await page.evaluate(
      () => document.activeElement?.tagName ?? 'none',
    )
    if (active === 'INPUT') throw new Error('search input kept focus after select — keyboard would stay open')
    console.log('pass: search input blurs on select (touch)')

    // Selection behavior depends on what's merged:
    //   pending-add (banner + Cancel) on pre-instant-add branches; instant
    //   append on #101+. Removal is immediate pre-#103, undo-window after.
    //   Every path below leaves zero net writes.
    const banner = page.getByText(/choose a position below/i)
    if (await banner.count()) {
      await page.getByRole('button', { name: /cancel/i }).click()
      await page.waitForTimeout(200)
      const afterCancel = await rankedNames(page)
      if (afterCancel.length !== before.length) throw new Error('cancelled add changed the list')
      console.log('pass: selection enters pending-add mode; cancelled (no write)')
    } else {
      const afterAdd = await rankedNames(page)
      const added = afterAdd[afterAdd.length - 1]
      if (!added || afterAdd.length !== before.length + 1) {
        throw new Error(`selection neither entered pending-add nor appended: ${afterAdd.length} vs ${before.length}`)
      }
      console.log(`pass: selection instantly added "${added}" at #${afterAdd.length}`)

      // Removal contract:
      //   pre-#103: immediate server delete — row gone right away.
      //   #103+: undo window (toast with Undo) — undo restores; expiring
      //   window commits the delete. Either way: zero net writes.
      await page.getByRole('button', { name: `Remove ${added}` }).click()
      const undo = page.getByRole('button', { name: 'Undo' })
      const hasUndo = await undo
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false)
      if (hasUndo) {
        await undo.click()
        await page.waitForTimeout(600)
        const afterUndo = await rankedNames(page)
        if (afterUndo.length !== afterAdd.length) throw new Error('undo did not restore the row')
        console.log('pass: undo restored the removed row (still in list)')

        // Remove again and let the undo window expire → delete commits.
        await page.getByRole('button', { name: `Remove ${added}` }).click()
        await page.waitForTimeout(7000) // dissolve 280ms + undo 5000ms + refetch
        const final = await rankedNames(page)
        if (final.length !== before.length) {
          throw new Error(`deferred delete did not commit: ${final.length} rows, want ${before.length}`)
        }
        console.log('pass: deferred delete committed after undo window')
      } else {
        await page.waitForTimeout(1500) // immediate delete + refetch
        const afterRemove = await rankedNames(page)
        if (afterRemove.length !== before.length) {
          throw new Error(`immediate remove failed: ${afterRemove.length} rows, want ${before.length}`)
        }
        console.log('pass: remove committed immediately (pre-#103 behavior)')
      }
    }

    // Long-press drag via the handle (dnd-kit TouchSensor, 200ms delay).
    // The instant-add highlight scrolled to the bottom of the list — rows
    // near the top now have off-screen coordinates, and CDP touch events at
    // those coordinates land nowhere. Reset scroll first.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    if (before.length < 5) throw new Error(`need >=5 ranked rows, found ${before.length}`)
    const dragTarget = before[2]
    if (!dragTarget) throw new Error('missing row 3')
    const from = await dragHandleCenter(page, 2)
    const to = await dragHandleCenter(page, 0)
    const { scrollYBefore, scrollYAfter } = await longPressDrag(
      page,
      from,
      { x: to.x - from.x, y: to.y - from.y },
    )
    const after = await rankedNames(page)
    if (after[0] !== dragTarget) {
      throw new Error(`long-press drag failed: expected ${dragTarget} at #1, got order ${after.slice(0, 5).join(', ')}`)
    }
    console.log('pass: long-press drag moved row up two slots')
    if (scrollYBefore !== scrollYAfter) {
      throw new Error(`scroll guard failed: page scrolled ${scrollYBefore} -> ${scrollYAfter} during drag`)
    }
    console.log('pass: page did not scroll during drag')

    // Restore the exact original order (re-reset scroll — the drag may have
    // auto-scrolled the page). dragTarget started at index 2.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    const idx = after.indexOf(dragTarget)
    const fromRestored = await dragHandleCenter(page, idx)
    const toRestored = await dragHandleCenter(page, 2)
    await longPressDrag(page, fromRestored, {
      x: toRestored.x - fromRestored.x,
      y: toRestored.y - fromRestored.y,
    })
    const restored = await rankedNames(page)
    if (JSON.stringify(restored) !== JSON.stringify(before)) {
      throw new Error(`restore failed:\n  want ${before.join(', ')}\n  got  ${restored.join(', ')}`)
    }
    console.log('pass: order restored')

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
