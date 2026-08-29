// Shared SQL building helpers.

type Cast = string | undefined

// Builds a multi-row INSERT with positional params. `casts[i]` (e.g. "jsonb")
// is appended to the placeholder for column i. pg's param limit is 65535, so
// keep chunk sizes modest.
export function multiRowInsert(
  table: string,
  columns: readonly string[],
  casts: readonly Cast[],
  rows: ReadonlyArray<readonly unknown[]>,
): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const values = rows.map((row) => {
    const cells = row.map((value, colIdx) => {
      params.push(value)
      const cast = casts[colIdx]
      return cast ? `$${params.length}::${cast}` : `$${params.length}`
    })
    return `(${cells.join(', ')})`
  })
  return {
    sql: `insert into ${table} (${columns.join(', ')}) values ${values.join(', ')}`,
    params,
  }
}

export function parseCsv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}
