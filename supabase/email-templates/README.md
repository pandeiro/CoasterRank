# Supabase auth email templates — source of truth

CoasterRank's auth emails (custom SMTP via Resend) are versioned here and synced to the
Supabase project with `npm run sync-email-templates` (from `scripts/`). The dashboard
(Authentication → Emails) edits the same underlying config — this directory exists so
changes go through PR review and git history instead of click-ops.

## Files

| File                 | GoTrue config fields                                                       | Triggered by                              |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| `confirm-signup.html`| `mailer_subjects_confirmation` + `mailer_templates_confirmation_content`   | `signUp()` (signup confirmation)          |
| `magic-link.html`    | `mailer_subjects_magic_link` + `mailer_templates_magic_link_content`       | `signInWithOtp()` (link + 8-digit code)   |
| `reset-password.html`| `mailer_subjects_recovery` + `mailer_templates_recovery_content`           | `resetPasswordForEmail()`                 |
| `invite-user.html`   | `mailer_subjects_invite` + `mailer_templates_invite_content`               | admin invite (admin-users Edge Function)  |
| `subjects.json`      | the four `mailer_subjects_*` values                                        | —                                         |

Not covered (still on Supabase defaults, fine — no flow triggers them yet): invite is the
only extra one wired today; email change / reauthentication / security-notification
templates are untouched.

## Design system (why the HTML looks like this)

- **Table-based layout, inline CSS only.** Gmail strips `<style>` blocks; Outlook uses the
  Word rendering engine. 600px card on the cream canvas (`#FEFCF3`), white card, ink text
  (`#1A1A2E`), muted body (`#4A4A5A`), cyan CTA pill (`#159AB8` — matches the app's
  rounded-full buttons), coral "lap bar" accent (`#E85D75`), line color `#E0DBD1`.
- **Text-first.** The only image is the small brand mark (hosted at
  `https://coasterrank.app/email-mark.png`); Gmail blocks images by default, so every
  template must read fine with the `alt="CoasterRank"` box in its place. No other imagery.
- **Web fonts won't load in email.** Stack is `'Inter', -apple-system, 'Segoe UI', Roboto,
  Helvetica, Arial` — Inter when installed, system fallbacks otherwise.
- **Every template carries:** hidden preheader text, a plain-text fallback link under the
  CTA button, a "didn't request this?" line, and a reply-friendly footer (no
  `no-reply` — replies go to the SMTP sender identity).
- **Go template syntax:** `{{ .ConfirmationURL }}` (the action link — honors the
  `emailRedirectTo` the app passed) and `{{ .Token }}` (the OTP). Braces in inline CSS
  would break the template parser — never add `<style>` or `<script>`.
- **Expiry copy is load-bearing:** the project's `mailer_otp_exp` is **3600 s** and
  `mailer_otp_length` is **8** — all four links/codes expire in **1 hour**. If the
  dashboard setting changes, update every "expires in 1 hour" string.

## Syncing

```bash
cd scripts
npm run sync-email-templates           # dry-run: diffs repo vs. live project, no writes
npm run sync-email-templates -- --apply  # PATCH the project via the Management API
```

Needs `SUPABASE_ACCESS_TOKEN` + `PROJECT_REF` from the repo `.env` (same as the Supabase
CLI). Dry-run first is the norm; `--apply` round-trips a verification read after the write.
After applying, send yourself one live email of each type before calling it done — the
Management API confirms the config, not the rendering.
