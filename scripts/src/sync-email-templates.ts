// sync-email-templates — push supabase/email-templates/ to the Supabase project.
//
// Auth email templates live in project auth config (not migrations), so this
// script applies the repo copies via the Management API:
//   GET/PATCH https://api.supabase.com/v1/projects/{ref}/config/auth
//
// Dry-run by default (diff summary, no writes); --apply PATCHes and then
// re-reads the config to verify every field landed. Credentials come from the
// repo .env (SUPABASE_ACCESS_TOKEN + PROJECT_REF — same pattern as the CLI).
//
// Field names follow GoTrue's API config exactly: mailer_subjects_<key> and
// mailer_templates_<key>_content for each template key (see
// supabase/email-templates/README.md). Only those fields are ever sent —
// never SMTP credentials or other auth settings.
import dotenv from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') })

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(SCRIPT_DIR, '..', '..', 'supabase', 'email-templates')
const MANAGEMENT_API = 'https://api.supabase.com'

export interface TemplateKeyToFile {
  file: string
  /** subjects.json key — also the GoTrue config field suffix. */
  key: string
  subjectField: string
  contentField: string
}

// Order defines dry-run output order.
export const TEMPLATE_SPECS: TemplateKeyToFile[] = [
  {
    file: 'confirm-signup.html',
    key: 'confirmation',
    subjectField: 'mailer_subjects_confirmation',
    contentField: 'mailer_templates_confirmation_content',
  },
  {
    file: 'magic-link.html',
    key: 'magic_link',
    subjectField: 'mailer_subjects_magic_link',
    contentField: 'mailer_templates_magic_link_content',
  },
  {
    file: 'reset-password.html',
    key: 'recovery',
    subjectField: 'mailer_subjects_recovery',
    contentField: 'mailer_templates_recovery_content',
  },
  {
    file: 'invite-user.html',
    key: 'invite',
    subjectField: 'mailer_subjects_invite',
    contentField: 'mailer_templates_invite_content',
  },
]

export interface LoadedTemplates {
  /** subjects.json key → subject line (Go template syntax allowed). */
  subjects: Record<string, string>
  /** subjects.json key → full HTML body. */
  contents: Record<string, string>
}

export function loadTemplates(dir: string): LoadedTemplates {
  const subjectsPath = join(dir, 'subjects.json')
  if (!existsSync(subjectsPath)) {
    throw new Error(`Missing ${subjectsPath}`)
  }
  const subjects = JSON.parse(readFileSync(subjectsPath, 'utf8')) as Record<string, string>

  const contents: Record<string, string> = {}
  for (const spec of TEMPLATE_SPECS) {
    const path = join(dir, spec.file)
    if (!existsSync(path)) {
      throw new Error(`Missing ${path}`)
    }
    contents[spec.key] = readFileSync(path, 'utf8')
  }
  return { subjects, contents }
}

/** Flat GoTrue config payload: only ever contains subject/content fields. */
export function buildPayload(loaded: LoadedTemplates): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const spec of TEMPLATE_SPECS) {
    const subject = loaded.subjects[spec.key]
    const content = loaded.contents[spec.key]
    if (typeof subject !== 'string' || subject.trim() === '') {
      throw new Error(`subjects.json: missing subject for "${spec.key}"`)
    }
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error(`missing HTML body for "${spec.key}" (${spec.file})`)
    }
    payload[spec.subjectField] = subject
    payload[spec.contentField] = content
  }
  return payload
}

export type FieldStatus = 'unchanged' | 'update' | 'missing-live-value'

export interface FieldChange {
  field: string
  status: FieldStatus
  /** Live value (or undefined when the project has never set this field). */
  from?: string
  to: string
}

export function summarizeChanges(
  live: Record<string, unknown>,
  payload: Record<string, string>,
): FieldChange[] {
  return Object.entries(payload).map(([field, to]) => {
    const raw = live[field]
    if (typeof raw !== 'string') {
      return { field, status: 'missing-live-value' as const, to }
    }
    return raw === to
      ? { field, status: 'unchanged' as const, from: raw, to }
      : { field, status: 'update' as const, from: raw, to }
  })
}

function short(value: string | undefined): string {
  if (value === undefined) return '(not set)'
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine
}

function printSummary(changes: FieldChange[]): void {
  let updates = 0
  for (const c of changes) {
    if (c.status === 'unchanged') {
      console.log(`  ✓ ${c.field}: unchanged`)
    } else {
      updates++
      const label = c.status === 'missing-live-value' ? 'not set live' : 'differs'
      console.log(`  ✎ ${c.field}: ${label}`)
      console.log(`      live: ${short(c.from)}`)
      console.log(`      repo: ${short(c.to)}`)
    }
  }
  const unchanged = changes.length - updates
  console.log(`\n${updates} field(s) to update, ${unchanged} already in sync.`)
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply')
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = process.env.PROJECT_REF
  if (!token || !projectRef) {
    console.error('Error: SUPABASE_ACCESS_TOKEN and PROJECT_REF must be set (repo .env).')
    return 1
  }

  let loaded: LoadedTemplates
  try {
    loaded = loadTemplates(TEMPLATES_DIR)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }
  const payload = buildPayload(loaded)

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const configUrl = `${MANAGEMENT_API}/v1/projects/${projectRef}/config/auth`

  const liveRes = await fetch(configUrl, { headers })
  if (!liveRes.ok) {
    console.error(`Error: GET config/auth failed (${liveRes.status} ${liveRes.statusText})`)
    return 1
  }
  const live = (await liveRes.json()) as Record<string, unknown>

  console.log(`Supabase project ${projectRef} — email templates vs. supabase/email-templates/:\n`)
  const changes = summarizeChanges(live, payload)
  printSummary(changes)

  if (!apply) {
    console.log('\nDry run — re-run with --apply to push.')
    return 0
  }
  if (changes.every((c) => c.status === 'unchanged')) {
    console.log('\nNothing to apply.')
    return 0
  }

  const patchRes = await fetch(configUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  })
  if (!patchRes.ok) {
    const detail = await patchRes.text().catch(() => '')
    console.error(
      `Error: PATCH config/auth failed (${patchRes.status} ${patchRes.statusText})${detail ? `: ${detail.slice(0, 400)}` : ''}`,
    )
    return 1
  }
  console.log('\nPATCH accepted. Verifying…')

  const verifyRes = await fetch(configUrl, { headers })
  if (!verifyRes.ok) {
    console.error(`Error: verification read failed (${verifyRes.status} ${verifyRes.statusText})`)
    return 1
  }
  const after = (await verifyRes.json()) as Record<string, unknown>
  const mismatches = summarizeChanges(after, payload).filter((c) => c.status !== 'unchanged')
  if (mismatches.length > 0) {
    console.error(`Error: ${mismatches.length} field(s) did not stick:`)
    for (const m of mismatches) console.error(`  ${m.field}`)
    return 1
  }
  console.log('All fields verified live.')

  console.log(
    '\nDone. Send yourself one live email per type to confirm rendering — the API proves config, not inbox delivery.',
  )
  return 0
}

const invokedDirectly = process.argv[1]?.endsWith('sync-email-templates.ts')
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.stack : String(err))
      process.exitCode = 1
    })
}
