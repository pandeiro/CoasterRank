import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isProdRef,
  parseProjectRef,
  requireProdConsent,
  resolveTarget,
  type Connections,
} from '../testride/connections.js'

const REF = 'abcdefghijklmnopqrst'
const OTHER = 'zzzzzzzzzzzzzzzzzzzz'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function exitSpy(): { spy: ReturnType<typeof vi.spyOn>; exits: number[] } {
  const exits: number[] = []
  const spy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exits.push(code ?? 0)
    throw new Error(`process.exit:${code ?? 0}`)
  }) as never)
  return { spy, exits }
}

describe('parseProjectRef', () => {
  it('extracts the ref from a session-pooler Postgres URL (username form)', () => {
    expect(
      parseProjectRef(
        `postgresql://postgres.${REF}:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
        undefined,
      ),
    ).toBe(REF)
  })

  it('extracts the ref from a legacy supabase.co host', () => {
    expect(parseProjectRef(undefined, `https://${REF}.supabase.co`)).toBe(REF)
  })

  it('extracts the ref from a regional supabase.co host', () => {
    expect(parseProjectRef(undefined, `https://${REF}.us-west-2.supabase.co`)).toBe(REF)
  })

  it('returns null when nothing is parseable', () => {
    expect(parseProjectRef(undefined, undefined)).toBeNull()
    expect(parseProjectRef('not-a-url', 'also-not-a-url')).toBeNull()
  })
})

describe('isProdRef', () => {
  it('matches case-insensitively against $PROJECT_REF', () => {
    vi.stubEnv('PROJECT_REF', REF.toUpperCase())
    expect(isProdRef(REF)).toBe(true)
    expect(isProdRef(OTHER)).toBe(false)
  })

  it('is false when the ref or $PROJECT_REF is missing', () => {
    vi.stubEnv('PROJECT_REF', REF)
    expect(isProdRef(null)).toBe(false)
    vi.stubEnv('PROJECT_REF', '')
    expect(isProdRef(REF)).toBe(false)
  })
})

describe('resolveTarget (fail-closed)', () => {
  it('flags a PROJECT_REF match as prod (known)', () => {
    vi.stubEnv('PROJECT_REF', REF)
    const conns: Connections = { supabaseUrl: `https://${REF}.supabase.co` }
    expect(resolveTarget(conns)).toEqual({ ref: REF, prodRef: REF, isProd: true, unknown: false })
  })

  it('passes a non-matching ref as non-prod', () => {
    vi.stubEnv('PROJECT_REF', REF)
    const conns: Connections = { supabaseUrl: `https://${OTHER}.supabase.co` }
    const target = resolveTarget(conns)
    expect(target.isProd).toBe(false)
    expect(target.unknown).toBe(false)
  })

  it('treats an unparseable target as prod (unknown)', () => {
    vi.stubEnv('PROJECT_REF', REF)
    const target = resolveTarget({})
    expect(target.isProd).toBe(true)
    expect(target.unknown).toBe(true)
  })

  it('treats every target as prod when $PROJECT_REF is unset', () => {
    vi.stubEnv('PROJECT_REF', '')
    const target = resolveTarget({ supabaseUrl: `https://${OTHER}.supabase.co` })
    expect(target.isProd).toBe(true)
    expect(target.unknown).toBe(true)
  })
})

describe('requireProdConsent', () => {
  it('refuses prod without --prod', () => {
    vi.stubEnv('PROJECT_REF', REF)
    const { exits } = exitSpy()
    const conns: Connections = { supabaseUrl: `https://${REF}.supabase.co` }
    expect(() => requireProdConsent(conns, false, 'seed')).toThrow(/process\.exit:1/)
    expect(exits).toEqual([1])
  })

  it('refuses an unverifiable target without --prod', () => {
    vi.stubEnv('PROJECT_REF', '')
    const { exits } = exitSpy()
    expect(() => requireProdConsent({}, false, 'report')).toThrow(/process\.exit:1/)
    expect(exits).toEqual([1])
  })

  it('allows prod with --prod', () => {
    vi.stubEnv('PROJECT_REF', REF)
    const conns: Connections = { supabaseUrl: `https://${REF}.supabase.co` }
    const target = requireProdConsent(conns, true, 'cleanup')
    expect(target.isProd).toBe(true)
  })

  it('allows a non-prod target without --prod', () => {
    vi.stubEnv('PROJECT_REF', REF)
    const conns: Connections = { supabaseUrl: `https://${OTHER}.supabase.co` }
    const target = requireProdConsent(conns, false, 'report')
    expect(target.isProd).toBe(false)
  })
})
