/**
 * Scenario: static-page body typography previews — About + FAQ body copy at
 * the new text-base size (UI PR: "bump static-page body typography to 16px").
 *
 * Run: cd scripts && npx tsx src/e2e/scenarios/previews-static-body-size.ts
 *
 * State tier 1 (component/page only, no session, no mocks): both pages are
 * public and make no Supabase reads, so there is no prod contact at all.
 */
import { config } from 'dotenv'
config({ path: new URL('../../../../.env', import.meta.url).pathname })

import { chromium, type Page } from 'playwright'
import { capturePreviews, openPreview, prSnippet, waitForVisible } from '../previews'
import { ensureServer } from '../helpers'

const SLUG = 'static-body-size'

async function main(): Promise<void> {
  await ensureServer() // dev server on :5199
  const browser = await chromium.launch()
  try {
    const open =
      (path: string) =>
      async (kind: 'desktop' | 'mobile'): Promise<Page> => {
        const page = await openPreview(browser, kind)
        await page.goto(`http://localhost:5199${path}`)
        await waitForVisible(page, 'main')
        return page
      }

    const about = await capturePreviews(browser, SLUG, 'about', open('/about'), {
      clip: 'main',
    })
    const faq = await capturePreviews(browser, SLUG, 'faq', open('/faq'), {
      clip: 'main',
    })
    console.log(prSnippet(SLUG, [...about, ...faq]))
  } finally {
    await browser.close()
  }
}

void main()
