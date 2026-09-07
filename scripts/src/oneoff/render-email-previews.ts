/**
 * Render the four auth email templates to PNG for PR review.
 *
 * Substitutes the Go template variables with realistic mock values (8-digit
 * token, real-shaped verify URL so fallback-link wrapping is visible), then
 * screenshots each template at desktop + mobile width in two states:
 *   - images/   : coasterrank.app/email-mark.png is served from the committed
 *                 app/public/email-mark.png (emulates prod after merge)
 *   - noimg/    : the request is aborted (emulates Gmail's default image
 *                 blocking — the alt-text box is what image-off recipients see)
 *
 * Output goes to docs/previews/email-templates/ and is committed; refresh and
 * re-commit whenever template copy/layout changes.
 *
 * Usage: cd scripts && npx tsx src/oneoff/render-email-previews.ts
 */
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const templatesDir = join(root, 'supabase', 'email-templates')
const markPath = join(root, 'app', 'public', 'email-mark.png')
const outDir = join(root, 'docs', 'previews', 'email-templates')

const MARK_URL = 'https://coasterrank.app/email-mark.png'

const MOCKS: Record<string, string> = {
  '{{ .Token }}': '42819305',
  '{{ .Email }}': 'marina@example.com',
  '{{ .ConfirmationURL }}':
    'https://coasterrank.app/auth/v1/verify?token=8f14e45fceea167a5a36dedd4bea2543&type=email&redirect_to=https%3A%2F%2Fcoasterrank.app%2Flogin%3Fconfirmed%3D1%26next%3D%252Friders%252Fmarina_thrills',
}

const TEMPLATES = ['confirm-signup', 'magic-link', 'reset-password', 'invite-user']
const VIEWPORTS = [
  { label: 'desktop', width: 660 },
  { label: 'mobile', width: 375 },
] as const

function mockVars(html: string): string {
  let out = html
  for (const [variable, value] of Object.entries(MOCKS)) {
    out = out.split(variable).join(value)
  }
  // Surface any un-substituted Go variables loudly rather than shipping a
  // preview with template syntax visible in only one spot.
  const leftover = out.match(/\{\{ \.[A-Za-z]+ \}\}/g)
  if (leftover) {
    throw new Error(`Unsubstituted template variables: ${leftover.join(', ')}`)
  }
  return out
}

async function render(
  browser: Browser,
  html: string,
  images: boolean,
  width: number,
  outPath: string,
): Promise<void> {
  const page: Page = await browser.newPage({ viewport: { width, height: 1200 } })
  await page.route(MARK_URL, (route) =>
    images ? route.fulfill({ path: markPath, contentType: 'image/png' }) : route.abort('aborted'),
  )
  await page.setContent(html, { waitUntil: 'networkidle' })
  await page.screenshot({ path: outPath, fullPage: true })
  await page.close()
}

const markBytes = (await readFile(markPath)).length
if (markBytes < 1000) throw new Error('email-mark.png looks missing/corrupt')

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
try {
  for (const name of TEMPLATES) {
    const html = mockVars(await readFile(join(templatesDir, `${name}.html`), 'utf8'))
    for (const images of [true, false]) {
      const state = images ? 'images' : 'noimg'
      for (const { label, width } of VIEWPORTS) {
        const outPath = join(outDir, `${name}-${state}-${label}.png`)
        await render(browser, html, images, width, outPath)
        console.log(`${name}-${state}-${label}.png`)
      }
    }
  }
} finally {
  await browser.close()
}
console.log(`\nWrote ${TEMPLATES.length * 4} PNGs to docs/previews/email-templates/`)
