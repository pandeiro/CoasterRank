// Manual recompute trigger: invokes the recompute-rankings Edge Function with
// the service-role key — the same path a manual /admin click takes (the pg_cron
// schedules are unscheduled on the bench project; every run here is manual).
import { loadBenchEnv } from './env'

const TIMEOUT_MS = 600_000

export interface InvokeResult {
  ok: boolean
  status: number
  invokeMs: number
  body: string
}

export async function invokeRecompute(functionName = 'recompute-rankings'): Promise<InvokeResult> {
  const { supabaseUrl, serviceKey } = loadBenchEnv()
  const started = Date.now()
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await res.text()
    return { ok: res.ok, status: res.status, invokeMs: Date.now() - started, body }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, invokeMs: Date.now() - started, body: message }
  }
}
