# Auth email template previews

Committed screenshots of the four auth emails in `supabase/email-templates/` for PR review —
regenerate with `cd scripts && npx tsx src/oneoff/render-email-previews.ts` whenever template
copy/layout changes, and re-commit.

Each template appears in four shots:

- **`-images-`** — the brand mark loads (Playwright serves the committed
  `app/public/email-mark.png` for `coasterrank.app/email-mark.png`), emulating prod after
  merge / clients that allow remote images.
- **`-noimg-`** — the image request is aborted, emulating **Gmail's default** (remote images
  blocked): the header shows the `alt="CoasterRank"` fallback box. This is the state most
  recipients see, and the reason the templates are fully readable text-first.
- **`-desktop-`** (660px) / **`-mobile-`** (375px) viewports.

Go template variables are mocked for preview only: `{{ .Token }}` → `42819305`,
`{{ .Email }}` → `marina@example.com`, `{{ .ConfirmationURL }}` → a real-shaped verify URL
(long, so the fallback-link wrapping is visible). The screenshots never contain real user
data.
