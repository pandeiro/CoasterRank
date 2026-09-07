// Tests for the sync-email-templates pure helpers + a repo-integrity guard:
// the committed supabase/email-templates/ must always load, reference the
// required Go template variables, and map onto exactly the eight GoTrue
// config fields the script is allowed to touch.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TEMPLATE_SPECS,
  buildPayload,
  loadTemplates,
  summarizeChanges,
  type LoadedTemplates,
} from '../sync-email-templates'

const REPO_TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'supabase',
  'email-templates',
)

describe('buildPayload', () => {
  const loaded: LoadedTemplates = {
    subjects: {
      confirmation: 'Confirm',
      magic_link: '{{ .Token }} is your code',
      recovery: 'Reset',
      invite: 'Invite',
    },
    contents: { confirmation: '<a/>', magic_link: '<b/>', recovery: '<c/>', invite: '<d/>' },
  }

  it('maps each template onto its exact GoTrue subject/content fields', () => {
    expect(buildPayload(loaded)).toEqual({
      mailer_subjects_confirmation: 'Confirm',
      mailer_templates_confirmation_content: '<a/>',
      mailer_subjects_magic_link: '{{ .Token }} is your code',
      mailer_templates_magic_link_content: '<b/>',
      mailer_subjects_recovery: 'Reset',
      mailer_templates_recovery_content: '<c/>',
      mailer_subjects_invite: 'Invite',
      mailer_templates_invite_content: '<d/>',
    })
  })

  it('emits exactly eight fields — never SMTP credentials or unrelated auth config', () => {
    const payload = buildPayload(loaded)
    expect(Object.keys(payload)).toHaveLength(8)
    for (const key of Object.keys(payload)) {
      expect(key.startsWith('mailer_subjects_') || key.startsWith('mailer_templates_')).toBe(true)
    }
  })

  it('rejects an empty subject', () => {
    expect(() =>
      buildPayload({ ...loaded, subjects: { ...loaded.subjects, recovery: '  ' } }),
    ).toThrow(/missing subject for "recovery"/)
  })
})

describe('loadTemplates', () => {
  it('loads the committed template set', () => {
    const loaded = loadTemplates(REPO_TEMPLATES_DIR)
    for (const spec of TEMPLATE_SPECS) {
      expect(loaded.subjects[spec.key] ?? '', spec.key).toBeTruthy()
      expect(loaded.contents[spec.key] ?? '', spec.file).toContain('{{ .ConfirmationURL }}')
    }
  })

  it('every committed subject is renderable (no stray template braces beyond Go vars)', () => {
    const loaded = loadTemplates(REPO_TEMPLATES_DIR)
    for (const spec of TEMPLATE_SPECS) {
      // Go template braces only appear as {{ .Var }} — no literal { or } elsewhere.
      expect((loaded.subjects[spec.key] ?? '').replace(/\{\{ \.[A-Za-z]+ \}\}/g, '')).not.toMatch(
        /[{}]/,
      )
    }
  })

  it('throws with a clear message when a file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-email-'))
    try {
      writeFileSync(join(dir, 'subjects.json'), JSON.stringify({ confirmation: 'x' }))
      expect(() => loadTemplates(dir)).toThrow(/Missing .*confirm-signup\.html/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('summarizeChanges', () => {
  it('classifies unchanged / update / not-set-live fields', () => {
    const payload = { mailer_subjects_invite: 'New', mailer_subjects_recovery: 'Also new' }
    const live: Record<string, unknown> = {
      mailer_subjects_invite: 'New',
      mailer_subjects_recovery: 'Old default',
      mailer_subjects_confirmation: '<h2>default</h2>',
    }
    const changes = summarizeChanges(live, payload)
    expect(changes).toHaveLength(2)
    expect(changes[0]?.field).toBe('mailer_subjects_invite')
    expect(changes[0]?.status).toBe('unchanged')
    expect(changes[0]?.from).toBe('New')
    expect(changes[1]?.field).toBe('mailer_subjects_recovery')
    expect(changes[1]?.status).toBe('update')
    expect(changes[1]?.from).toBe('Old default')
    expect(changes[1]?.to).toBe('Also new')
  })

  it('treats absent live fields as missing-live-value (never sent before)', () => {
    const changes = summarizeChanges({}, { mailer_templates_invite_content: '<html/>' })
    expect(changes[0]?.status).toBe('missing-live-value')
  })

  it('requires exact equality — whitespace differences are updates', () => {
    const changes = summarizeChanges(
      { mailer_subjects_invite: 'Invited ' },
      { mailer_subjects_invite: 'Invited' },
    )
    expect(changes[0]?.status).toBe('update')
  })
})
