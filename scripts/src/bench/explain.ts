// SQL-side decomposition for one grid point: EXPLAIN (ANALYZE, BUFFERS) the
// production function. pairwise_wins() is `language sql`, so Postgres inlines
// it and the plan shows the real join/aggregate shape the RPC executes.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { REPO_ROOT } from './env'

const PLANS_DIR = join(REPO_ROOT, 'scripts', 'src', 'bench', 'results', 'plans')

interface PlanSummary {
  executionTimeMs: number
  planningTimeMs: number
  tempBlocks: number
  sharedHitBlocks: number
  sharedReadBlocks: number
  maxPlanDepthNodes: number
}

function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (typeof node !== 'object' || node === null) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  const rec = node as Record<string, unknown>
  visit(rec)
  if (rec.Plans) walk(rec.Plans, visit)
}

function summarizePlan(plan: unknown): PlanSummary {
  let executionTimeMs = 0
  let planningTimeMs = 0
  let tempBlocks = 0
  let sharedHitBlocks = 0
  let sharedReadBlocks = 0
  walk(plan, (n) => {
    if (n['Execution Time'] !== undefined) executionTimeMs = n['Execution Time'] as number
    if (n['Planning Time'] !== undefined) planningTimeMs = n['Planning Time'] as number
    if (n['Temp Read Blocks'] !== undefined) tempBlocks += n['Temp Read Blocks'] as number
    if (n['Temp Written Blocks'] !== undefined) tempBlocks += n['Temp Written Blocks'] as number
    if (n['Shared Hit Blocks'] !== undefined) sharedHitBlocks += n['Shared Hit Blocks'] as number
    if (n['Shared Read Blocks'] !== undefined) sharedReadBlocks += n['Shared Read Blocks'] as number
  })
  return {
    executionTimeMs,
    planningTimeMs,
    tempBlocks,
    sharedHitBlocks,
    sharedReadBlocks,
    maxPlanDepthNodes: 0,
  }
}

export async function captureExplain(pool: Pool, label: string): Promise<PlanSummary | null> {
  const res = await pool.query<Record<string, unknown>>(
    'explain (analyze, buffers, format json) select * from public.pairwise_wins()',
  )
  // The explain column's name is "QUERY PLAN" — take whatever single column
  // came back instead of guessing the casing.
  const first = res.rows[0]
  const plan = first ? first[Object.keys(first)[0] as string] : undefined
  if (!plan) return null
  mkdirSync(PLANS_DIR, { recursive: true })
  writeFileSync(join(PLANS_DIR, `${label}.json`), JSON.stringify(plan, null, 2))
  return summarizePlan(plan)
}
