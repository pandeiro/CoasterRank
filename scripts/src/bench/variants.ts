// Variant registry: what SQL to apply before/after a run, and which Edge
// Function to invoke. 'baseline' = production shape as deployed; 'a-dirty' =
// trigger-maintained pair table (same function name, swapped body);
// 'b-plpgsql' = in-DB aggregation + MM fit via a forked function;
// 'ab-combined' = dirty-tracking pair table FEEDING the in-DB fit (no per-run
// rides self-join, no pair payload over the gateway).
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT } from './env'

export interface BenchVariant {
  name: string
  functionName: string
  installSql: string[]
  restoreSql: string[]
}

const SQL_DIR = join(REPO_ROOT, 'scripts', 'src', 'bench', 'sql')

export const VARIANTS: Record<string, BenchVariant> = {
  baseline: {
    name: 'baseline',
    functionName: 'recompute-rankings',
    installSql: [],
    restoreSql: [],
  },
  'a-dirty': {
    name: 'a-dirty',
    functionName: 'recompute-rankings',
    installSql: [join(SQL_DIR, 'a-dirty-install.sql')],
    restoreSql: [join(SQL_DIR, 'a-dirty-restore.sql')],
  },
  'b-plpgsql': {
    name: 'b-plpgsql',
    functionName: 'bench-recompute-plpgsql',
    installSql: [join(SQL_DIR, 'b-plpgsql-install.sql')],
    restoreSql: [],
  },
  'ab-combined': {
    name: 'ab-combined',
    functionName: 'bench-recompute-plpgsql',
    installSql: [
      join(SQL_DIR, 'b-plpgsql-install.sql'),
      join(SQL_DIR, 'a-dirty-install.sql'),
      join(SQL_DIR, 'ab-install.sql'),
    ],
    // Re-point the fit functions to the b shapes, drop the dirty machinery,
    // restore the production pairwise_wins body, then re-apply the canonical
    // b-plpgsql install (idempotent — leaves no ab overrides behind).
    restoreSql: [join(SQL_DIR, 'a-dirty-restore.sql'), join(SQL_DIR, 'b-plpgsql-install.sql')],
  },
}

export function resolveVariant(name: string | undefined): BenchVariant {
  const key = name ?? 'baseline'
  const v = VARIANTS[key]
  if (!v) {
    console.error(`Unknown variant "${key}". Known: ${Object.keys(VARIANTS).join(', ')}`)
    process.exit(1)
  }
  return v
}
