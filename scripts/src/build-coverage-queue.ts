import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPORT_FILE = join(SCRIPT_DIR, '..', '..', 'data', 'coverage', 'report.txt')
const QUEUE_FILE = join(SCRIPT_DIR, '..', '..', 'data', 'coverage', 'queue.json')
const SUMMARY_FILE = join(SCRIPT_DIR, '..', '..', 'data', 'coverage', 'queue-summary.md')
const TRIAGE_FILE = join(SCRIPT_DIR, '..', '..', 'data', 'coverage', 'master-triage.md')
const OVERRIDES_FILE = join(SCRIPT_DIR, '..', '..', 'data', 'coverage', 'queue-overrides.json')

const AUTO_MATCH_THRESHOLD = 0.4

type ParkStatus = 'exact' | 'fuzzy' | 'missing'

type CoasterStatus = 'exact' | 'fuzzy' | 'missing' | 'found_elsewhere'

type QueueAction =
  | 'accept_existing_match_no_change'
  | 'create_missing_park'
  | 'create_missing_coaster'
  | 'rehome_orphaned_coaster'
  | 'rehome_after_park_alias_fix'
  | 'human_review'

interface ParsedIssue {
  reportIcon: string
  lineNumber: number
  coasterName: string
  parkName: string
  notes: string[]
}

interface ParsedParkMatch {
  status: ParkStatus
  similarity: number | null
  matchedName: string | null
}

interface ParsedCoasterMatch {
  status: CoasterStatus
  similarity: number | null
  matchedName: string | null
  foundParkName: string | null
}

interface QueueItem {
  lineNumber: number
  sourceCoasterName: string
  sourceParkName: string
  normalizedCoasterKey: string
  reportIcon: string
  parkMatch: ParsedParkMatch
  coasterMatch: ParsedCoasterMatch
  action: QueueAction
  subtype: string
  confidence: number
  priority: 'high' | 'medium' | 'low'
  batchKey: string
  notes: string[]
  overrideReason: string | null
}

interface QueueOverride {
  action?: QueueAction
  subtype?: string
  confidence?: number
  priority?: 'high' | 'medium' | 'low'
  batchKey?: string
  parkMatch?: Partial<ParsedParkMatch>
  coasterMatch?: Partial<ParsedCoasterMatch>
  extraNotes?: string[]
  overrideReason: string
}

interface QueueOverridesFile {
  schemaVersion: number
  lineOverrides: Record<string, QueueOverride>
}

function normalizeAscii(input: string): string {
  return input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeKey(input: string): string {
  return normalizeAscii(input)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(input: string, fallback = 'unnamed'): string {
  const slug = normalizeAscii(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function parseIssueBlocks(report: string): ParsedIssue[] {
  const lines = report.split('\n')
  const issues: ParsedIssue[] = []
  let inIssueLog = false
  let current: ParsedIssue | null = null

  for (const line of lines) {
    if (line.includes('━━━ DETAILED ISSUE LOG')) {
      inIssueLog = true
      continue
    }
    if (!inIssueLog) continue
    if (line.startsWith('======================================================================')) break

    const headerMatch = line.match(/^\s*(❌|⚠️|🔍)\s+\[L(\d+)\]\s+(.*)$/)
    if (headerMatch) {
      if (current) issues.push(current)
      const rest = headerMatch[3]!.trim()
      const atIndex = rest.lastIndexOf(' @ ')
      if (atIndex === -1) continue

      current = {
        reportIcon: headerMatch[1]!,
        lineNumber: Number(headerMatch[2]),
        coasterName: rest.slice(0, atIndex).trim(),
        parkName: rest.slice(atIndex + 3).trim(),
        notes: [],
      }
      continue
    }

    const noteMatch = line.match(/^\s{4,}(.*\S.*)$/)
    if (noteMatch && current) {
      current.notes.push(noteMatch[1]!.trim())
    }
  }

  if (current) issues.push(current)
  return issues
}

function parseParkMatch(notes: string[]): ParsedParkMatch {
  for (const note of notes) {
    if (note.startsWith('Park NOT FOUND:')) {
      return { status: 'missing', similarity: null, matchedName: null }
    }

    const exact = note.match(/^Park exact: ".*" → "(.*)"$/)
    if (exact) {
      return { status: 'exact', similarity: 1, matchedName: exact[1]! }
    }

    const fuzzy = note.match(/^Park fuzzy \(([\d.]+)\): ".*" → "(.*)"$/)
    if (fuzzy) {
      return {
        status: 'fuzzy',
        similarity: Number(fuzzy[1]),
        matchedName: fuzzy[2]!,
      }
    }
  }

  throw new Error(`Could not parse park note block: ${notes.join(' | ')}`)
}

function parseCoasterMatch(notes: string[]): ParsedCoasterMatch {
  for (const note of notes) {
    const exact = note.match(/^Coaster exact: ".*" → "(.*)"$/)
    if (exact) {
      return { status: 'exact', similarity: 1, matchedName: exact[1]!, foundParkName: null }
    }

    const fuzzy = note.match(/^Coaster fuzzy \(([\d.]+)\) at .*: ".*" → "(.*)"$/)
    if (fuzzy) {
      return {
        status: 'fuzzy',
        similarity: Number(fuzzy[1]),
        matchedName: fuzzy[2]!,
        foundParkName: null,
      }
    }

    const elsewhere = note.match(/^Coaster NOT at .* but found at (.*) \(sim ([\d.]+)\): ".*"$/)
    if (elsewhere) {
      return {
        status: 'found_elsewhere',
        similarity: Number(elsewhere[2]),
        matchedName: null,
        foundParkName: elsewhere[1]!,
      }
    }

    const missing = note.match(/^Coaster NOT FOUND at .*: ".*"$/)
    if (missing) {
      return { status: 'missing', similarity: null, matchedName: null, foundParkName: null }
    }
  }

  return { status: 'missing', similarity: null, matchedName: null, foundParkName: null }
}

function tokenSet(input: string): Set<string> {
  return new Set(normalizeKey(input).split(' ').filter(Boolean))
}

function tokenOverlap(a: string, b: string): number {
  const left = tokenSet(a)
  const right = tokenSet(b)
  const intersection = [...left].filter((token) => right.has(token)).length
  const union = new Set([...left, ...right]).size
  if (union === 0) return 0
  return intersection / union
}

function parksLookLikeAliases(sourcePark: string, foundPark: string): boolean {
  const sourceKey = normalizeKey(sourcePark)
  const foundKey = normalizeKey(foundPark)

  if (!sourceKey || !foundKey) return false
  if (sourceKey === foundKey) return true
  if (sourceKey.includes(foundKey) || foundKey.includes(sourceKey)) return true
  return tokenOverlap(sourcePark, foundPark) >= 0.66
}

function classifyItem(
  issue: ParsedIssue,
  parkMatch: ParsedParkMatch,
  coasterMatch: ParsedCoasterMatch,
  duplicateSourceParkCount: number
): Omit<QueueItem, 'normalizedCoasterKey' | 'lineNumber' | 'sourceCoasterName' | 'sourceParkName' | 'reportIcon' | 'parkMatch' | 'coasterMatch' | 'notes' | 'overrideReason'> {
  const isTravelling = normalizeKey(issue.parkName) === 'travelling'
  const parkConfidence = parkMatch.similarity ?? 0
  const coasterConfidence = coasterMatch.similarity ?? 0
  const multipleTargetParks = duplicateSourceParkCount > 1

  if (parkMatch.status === 'missing') {
    return {
      action: 'create_missing_park',
      subtype: isTravelling ? 'synthetic_travelling_park' : 'missing_park',
      confidence: 1,
      priority: 'high',
      batchKey: `park:${slugify(issue.parkName)}`,
    }
  }

  if (coasterMatch.status === 'found_elsewhere') {
    if (coasterMatch.foundParkName === 'Other (unknown location)') {
      if (multipleTargetParks) {
        return {
          action: 'human_review',
          subtype: 'clone_rehome_from_other',
          confidence: coasterConfidence,
          priority: 'high',
          batchKey: `clone:${slugify(issue.coasterName)}`,
        }
      }

      return {
        action: 'rehome_orphaned_coaster',
        subtype: 'orphan_in_other_park',
        confidence: coasterConfidence,
        priority: 'high',
        batchKey: `rehome:${slugify(issue.parkName)}`,
      }
    }

    if (coasterMatch.foundParkName && parksLookLikeAliases(issue.parkName, coasterMatch.foundParkName)) {
      return {
        action: 'rehome_after_park_alias_fix',
        subtype: 'park_alias_split',
        confidence: coasterConfidence,
        priority: 'high',
        batchKey: `park-alias:${slugify(issue.parkName)}`,
      }
    }

    return {
      action: 'human_review',
      subtype: 'same_name_collision_or_wrong_park',
      confidence: coasterConfidence,
      priority: 'high',
      batchKey: `review:${slugify(issue.coasterName)}`,
    }
  }

  if (coasterMatch.status === 'missing') {
    if (parkMatch.status === 'fuzzy' && parkConfidence < AUTO_MATCH_THRESHOLD) {
      return {
        action: 'human_review',
        subtype: 'low_confidence_park_match',
        confidence: parkConfidence,
        priority: 'high',
        batchKey: `review:${slugify(issue.parkName)}`,
      }
    }

    return {
      action: 'create_missing_coaster',
      subtype: parkMatch.status === 'exact' ? 'known_park' : 'known_park_fuzzy_alias',
      confidence: Math.max(parkConfidence, 0.7),
      priority: 'high',
      batchKey: `park:${slugify(parkMatch.matchedName ?? issue.parkName)}`,
    }
  }

  if (coasterMatch.status === 'fuzzy') {
    if (coasterConfidence >= AUTO_MATCH_THRESHOLD && (parkMatch.status === 'exact' || parkConfidence >= AUTO_MATCH_THRESHOLD)) {
      return {
        action: 'accept_existing_match_no_change',
        subtype: 'likely_name_variant',
        confidence: coasterConfidence,
        priority: 'low',
        batchKey: `accept:${slugify(parkMatch.matchedName ?? issue.parkName)}`,
      }
    }

    return {
      action: 'human_review',
      subtype: 'low_confidence_fuzzy_match',
      confidence: Math.max(parkConfidence, coasterConfidence),
      priority: 'medium',
      batchKey: `review:${slugify(issue.coasterName)}`,
    }
  }

  if (coasterMatch.status === 'exact' && parkMatch.status === 'fuzzy') {
    if (parkConfidence >= AUTO_MATCH_THRESHOLD) {
      return {
        action: 'accept_existing_match_no_change',
        subtype: 'likely_park_alias',
        confidence: parkConfidence,
        priority: 'low',
        batchKey: `accept:${slugify(parkMatch.matchedName ?? issue.parkName)}`,
      }
    }

    return {
      action: 'human_review',
      subtype: 'low_confidence_park_fuzzy_match',
      confidence: parkConfidence,
      priority: 'medium',
      batchKey: `review:${slugify(issue.parkName)}`,
    }
  }

  return {
    action: 'accept_existing_match_no_change',
    subtype: 'exact_match_with_minor_metadata_issue',
    confidence: 1,
    priority: 'low',
    batchKey: `accept:${slugify(issue.parkName)}`,
  }
}

function buildSummary(queue: QueueItem[]): string {
  const count = (action: QueueAction) => queue.filter((item) => item.action === action).length
  const missingParkGroups = new Map<string, number>()
  const humanReviewGroups = new Map<string, QueueItem[]>()
  const overridden = queue.filter((item) => item.overrideReason)

  for (const item of queue) {
    if (item.action === 'create_missing_park') {
      missingParkGroups.set(item.sourceParkName, (missingParkGroups.get(item.sourceParkName) ?? 0) + 1)
    }
    if (item.action === 'human_review') {
      humanReviewGroups.set(item.subtype, [...(humanReviewGroups.get(item.subtype) ?? []), item])
    }
  }

  const lines: string[] = []
  lines.push('# Coverage Queue Summary')
  lines.push('')
  lines.push('Generated from `data/coverage/report.txt` by `scripts/src/build-coverage-queue.ts`.')
  lines.push('Manual overrides from `data/coverage/queue-overrides.json`.')
  lines.push('')
  lines.push('## Action Counts')
  lines.push('')
  lines.push(`- \`create_missing_park\`: ${count('create_missing_park')}`)
  lines.push(`- \`create_missing_coaster\`: ${count('create_missing_coaster')}`)
  lines.push(`- \`rehome_orphaned_coaster\`: ${count('rehome_orphaned_coaster')}`)
  lines.push(`- \`rehome_after_park_alias_fix\`: ${count('rehome_after_park_alias_fix')}`)
  lines.push(`- \`human_review\`: ${count('human_review')}`)
  lines.push(`- \`accept_existing_match_no_change\`: ${count('accept_existing_match_no_change')}`)
  lines.push('')
  lines.push('## Missing Parks')
  lines.push('')

  for (const [parkName, entries] of [...missingParkGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${parkName}: ${entries} affected checklist entr${entries === 1 ? 'y' : 'ies'}`)
  }

  lines.push('')

  if (overridden.length > 0) {
    lines.push('## Applied Overrides')
    lines.push('')
    for (const item of overridden) {
      lines.push(`- [L${item.lineNumber}] ${item.sourceCoasterName} @ ${item.sourceParkName}: ${item.overrideReason}`)
    }
    lines.push('')
  }

  lines.push('## Human Review')
  lines.push('')

  for (const [subtype, items] of [...humanReviewGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${subtype}`)
    lines.push('')
    for (const item of items.slice(0, 12)) {
      const foundElsewhere = item.coasterMatch.foundParkName ? ` -> ${item.coasterMatch.foundParkName}` : ''
      lines.push(`- [L${item.lineNumber}] ${item.sourceCoasterName} @ ${item.sourceParkName}${foundElsewhere}`)
    }
    if (items.length > 12) {
      lines.push(`- ... ${items.length - 12} more`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function buildMasterTriage(queue: QueueItem[]): string {
  const unresolved = queue.filter((item) => item.action !== 'accept_existing_match_no_change')
  const grouped = new Map<string, QueueItem[]>()

  for (const item of unresolved) {
    const key = item.action === 'human_review' ? `human_review:${item.subtype}` : item.action
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }

  const lines: string[] = []
  lines.push('# Master Triage List')
  lines.push('')
  lines.push('Current unresolved items from the original 503-entry coverage checklist.')
  lines.push('Generated from `data/coverage/queue.json`.')
  lines.push('')
  lines.push(`- Total unresolved items: ${unresolved.length}`)
  lines.push('- Current coverage: see `report.txt` and `queue-summary.md`')
  lines.push('')
  lines.push('## How To Use')
  lines.push('')
  lines.push('- Use `L<number>` as the stable key when adding notes or overrides.')
  lines.push('- `rehome_orphaned_coaster`: usually a targeted UPDATE against an existing row in `Other (unknown location)`.')
  lines.push('- `rehome_after_park_alias_fix`: usually means the park naming is off, not that the coaster is missing.')
  lines.push('- `human_review:*`: needs a person to decide between alias, create, rehome, or ignore.')
  lines.push('')

  const order = [
    'rehome_orphaned_coaster',
    'rehome_after_park_alias_fix',
    'human_review:same_name_collision_or_wrong_park',
    'human_review:clone_rehome_from_other',
    'human_review:low_confidence_park_match',
    'human_review:low_confidence_fuzzy_match',
    'human_review:low_confidence_park_fuzzy_match',
    'human_review:suspect_external_entry',
  ]

  for (const key of order) {
    const items = grouped.get(key)
    if (!items || items.length === 0) continue

    const heading = key.startsWith('human_review:') ? key.replace('human_review:', '') : key
    lines.push(`## ${heading}`)
    lines.push('')

    for (const item of items) {
      lines.push(`### L${item.lineNumber} ${item.sourceCoasterName} @ ${item.sourceParkName}`)
      lines.push('')
      lines.push(`- Action: \`${item.action}\``)
      lines.push(`- Priority: ${item.priority}`)
      lines.push(`- Confidence: ${item.confidence}`)
      if (item.parkMatch.matchedName) {
        lines.push(`- Park match: ${item.parkMatch.status} -> ${item.parkMatch.matchedName}`)
      }
      if (item.coasterMatch.foundParkName) {
        lines.push(`- Found elsewhere: ${item.coasterMatch.foundParkName}`)
      }
      if (item.coasterMatch.matchedName) {
        lines.push(`- Coaster match: ${item.coasterMatch.status} -> ${item.coasterMatch.matchedName}`)
      }
      if (item.overrideReason) {
        lines.push(`- Override: ${item.overrideReason}`)
      }
      lines.push('- Evidence:')
      for (const note of item.notes) {
        lines.push(`  - ${note}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

function loadOverrides(): Map<number, QueueOverride> {
  if (!existsSync(OVERRIDES_FILE)) return new Map<number, QueueOverride>()

  const parsed = JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8')) as QueueOverridesFile
  const entries = Object.entries(parsed.lineOverrides).map(([lineNumber, override]) => [Number(lineNumber), override] as const)
  return new Map<number, QueueOverride>(entries)
}

function applyOverride(item: QueueItem, override: QueueOverride | undefined): QueueItem {
  if (!override) return item

  return {
    ...item,
    action: override.action ?? item.action,
    subtype: override.subtype ?? item.subtype,
    confidence: override.confidence ?? item.confidence,
    priority: override.priority ?? item.priority,
    batchKey: override.batchKey ?? item.batchKey,
    parkMatch: override.parkMatch ? { ...item.parkMatch, ...override.parkMatch } : item.parkMatch,
    coasterMatch: override.coasterMatch ? { ...item.coasterMatch, ...override.coasterMatch } : item.coasterMatch,
    notes: override.extraNotes ? [...item.notes, ...override.extraNotes] : item.notes,
    overrideReason: override.overrideReason,
  }
}

function main() {
  const report = readFileSync(REPORT_FILE, 'utf8')
  const issues = parseIssueBlocks(report)
  const overrides = loadOverrides()

  const sourceParkCountByCoaster = new Map<string, Set<string>>()
  for (const issue of issues) {
    const key = normalizeKey(issue.coasterName)
    const set = sourceParkCountByCoaster.get(key) ?? new Set<string>()
    set.add(issue.parkName)
    sourceParkCountByCoaster.set(key, set)
  }

  const queue: QueueItem[] = issues
    .map((issue) => {
      const parkMatch = parseParkMatch(issue.notes)
      const coasterMatch = parseCoasterMatch(issue.notes)
      const normalizedCoasterKey = normalizeKey(issue.coasterName)
      const duplicateSourceParkCount = sourceParkCountByCoaster.get(normalizedCoasterKey)?.size ?? 1
      const classified = classifyItem(issue, parkMatch, coasterMatch, duplicateSourceParkCount)

      return {
        lineNumber: issue.lineNumber,
        sourceCoasterName: issue.coasterName,
        sourceParkName: issue.parkName,
        normalizedCoasterKey,
        reportIcon: issue.reportIcon,
        parkMatch,
        coasterMatch,
        notes: issue.notes,
        ...classified,
        overrideReason: null,
      }
    })
    .map((item) => applyOverride(item, overrides.get(item.lineNumber)))
    .sort((left, right) => {
      const actionOrder: Record<QueueAction, number> = {
        create_missing_park: 0,
        rehome_after_park_alias_fix: 1,
        rehome_orphaned_coaster: 2,
        create_missing_coaster: 3,
        human_review: 4,
        accept_existing_match_no_change: 5,
      }

      return (
        actionOrder[left.action] - actionOrder[right.action] ||
        left.sourceParkName.localeCompare(right.sourceParkName) ||
        left.sourceCoasterName.localeCompare(right.sourceCoasterName)
      )
    })

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    thresholds: {
      autoMatch: AUTO_MATCH_THRESHOLD,
    },
    policy: {
      travellingSyntheticPark: true,
      deferNameCleanup: true,
      cloneRehomesNeedHumanReview: true,
    },
    appliedOverrideCount: queue.filter((item) => item.overrideReason).length,
    counts: queue.reduce<Record<string, number>>((acc, item) => {
      acc[item.action] = (acc[item.action] ?? 0) + 1
      return acc
    }, {}),
    items: queue,
  }

  writeFileSync(QUEUE_FILE, JSON.stringify(payload, null, 2) + '\n')
  writeFileSync(SUMMARY_FILE, buildSummary(queue) + '\n')
  writeFileSync(TRIAGE_FILE, buildMasterTriage(queue) + '\n')

  console.log(`Parsed ${issues.length} issue entries`)
  console.log(`Wrote ${QUEUE_FILE}`)
  console.log(`Wrote ${SUMMARY_FILE}`)
  console.log(`Wrote ${TRIAGE_FILE}`)
}

main()
