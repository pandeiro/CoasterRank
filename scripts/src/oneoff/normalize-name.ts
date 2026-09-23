// Pure name-normalization core for the normalize-names oneoff CLI.
// Lives in its own side-effect-free module (no DB client, no argv parsing)
// so unit tests can import it without env vars or CLI side effects.
export function normalizeName(name: string): { cleaned: string; changed: boolean } {
  const cleaned = name.replace(/\s*\(.*\)\s*$/, '').trim()
  return { cleaned, changed: cleaned !== name }
}
