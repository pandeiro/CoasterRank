// Admin-only, read-only, on-demand weighting comparison (PLAN §5.1).
//
// Fits Bradley-Terry strengths in memory over the SAME ranked user_rides data
// under the production default weighting (pairwise_wins()) and under
// admin-selected alternatives (pairwise_wins_custom(gamma, floor_pairs,
// ramp_k)), and returns both boards plus agreement stats. NOTHING is
// persisted: coaster_ratings, rank_weekly_snapshots and cron_execution_logs
// are never touched. (cron_execution_logs is avoided deliberately —
// check_stale_recompute alerts on ANY recent success row, so a comparison
// run logged there would mask a genuinely stale recompute.)
//
// Auth — exactly one of:
//   1. Bearer <SUPABASE_SERVICE_ROLE_KEY> — ops debugging via curl
//   2. Bearer <user JWT of an admin>      — the SPA's /admin panel
//      (supabase.functions.invoke). The JWT is validated against GoTrue,
//      then profiles.is_admin is checked server-side.
//
// Request:  POST { variants: [{ gamma, floor_pairs?, ramp_k?, label? }],
//                 topN? }
//           1-4 variants; gamma clamped to [0,1]; floor_pairs/ramp_k are
//           non-negative integers (capped); ramp_k=0 disables the ramp.
// Response: 200 { default: { rows }, variants: [{ label, params, rows,
//           summary }], durationMs }
//           rows: [{ coaster_id, score, rank }] sorted by rank asc.
//           summary (each variant vs default): { spearman, top10Overlap,
//           maxRankDelta, meanAbsRankDelta, compared }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
// Pure-TS MM implementation shared with the Vitest suite; bundled at deploy.
import { computeRankings, type Pair } from "../../../packages/bt/src/mm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type PairRow = { winner: string; loser: string; weight: number; wins: number };

type VariantSpec = {
  gamma: number;
  floor_pairs: number;
  ramp_k: number;
  label?: string;
};

type RatedRow = { coaster_id: string; score: number; rank: number };

type VariantSummary = {
  spearman: number | null;
  top10Overlap: number | null;
  maxRankDelta: number | null;
  meanAbsRankDelta: number | null;
  /** Coasters ranked under both the variant and the default. */
  compared: number;
};

const MAX_VARIANTS = 4;
const MAX_FLOOR = 100_000;
const MAX_RAMP_K = 1_000;

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseVariants(raw: unknown): VariantSpec[] | string {
  if (!Array.isArray(raw) || raw.length === 0)
    return "variants must be a non-empty array";
  if (raw.length > MAX_VARIANTS)
    return `at most ${MAX_VARIANTS} variants per request`;
  const specs: VariantSpec[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null)
      return "each variant must be an object";
    const v = item as Record<string, unknown>;
    const gamma = Number(v.gamma);
    if (!Number.isFinite(gamma)) return "variant.gamma must be a number";
    const label =
      typeof v.label === "string" && v.label.trim()
        ? v.label.trim().slice(0, 80)
        : undefined;
    specs.push({
      gamma: Math.min(1, Math.max(0, gamma)),
      floor_pairs: clampInt(v.floor_pairs, 0, MAX_FLOOR, 0),
      ramp_k: clampInt(v.ramp_k, 0, MAX_RAMP_K, 0),
      label,
    });
  }
  return specs;
}

// Structural client type: avoids dragging SupabaseClient's generics through
// the helper signature (Deno's strict check trips on the widened defaults).
type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

// Pairwise RPC → computeRankings, with one retry on transient PostgREST 5xx
// (same PGRST303 backoff as recompute-rankings).
async function fit(
  supabase: RpcClient,
  rpcName: string,
  args?: Record<string, unknown>,
): Promise<{ rows: RatedRow[]; pairCount: number } | string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await supabase.rpc(rpcName, args);
    if (res.error) {
      if (res.error.code === "PGRST303" && attempt === 0) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      return `${rpcName}: ${res.error.message}`;
    }
    const pairs = (res.data ?? []) as PairRow[];
    const { rows } = computeRankings(
      pairs.map((r) => ({
        winner: r.winner,
        loser: r.loser,
        weight: r.weight,
        wins: r.wins,
      })),
    );
    return {
      rows: rows.map((r, i) => ({
        coaster_id: r.coasterId,
        score: r.score,
        rank: i + 1,
      })),
      pairCount: pairs.length,
    };
  }
  return `${rpcName}: retry exhausted`;
}

function summarize(defaults: RatedRow[], variant: RatedRow[]): VariantSummary {
  const defById = new Map(defaults.map((r) => [r.coaster_id, r]));
  const varById = new Map(variant.map((r) => [r.coaster_id, r]));
  const shared = [...defById.keys()].filter((id) => varById.has(id));
  if (shared.length < 2) {
    return {
      spearman: null,
      top10Overlap: null,
      maxRankDelta: null,
      meanAbsRankDelta: null,
      compared: shared.length,
    };
  }
  const dRanks = shared.map((id) => defById.get(id)!.rank);
  const vRanks = shared.map((id) => varById.get(id)!.rank);
  const n = shared.length;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / n;
  const md = mean(dRanks);
  const mv = mean(vRanks);
  let num = 0;
  let dd = 0;
  let vv = 0;
  for (let i = 0; i < n; i++) {
    num += (dRanks[i] - md) * (vRanks[i] - mv);
    dd += (dRanks[i] - md) ** 2;
    vv += (vRanks[i] - mv) ** 2;
  }
  const spearman = dd > 0 && vv > 0 ? num / Math.sqrt(dd * vv) : null;
  const deltas = shared.map((id) =>
    Math.abs(varById.get(id)!.rank - defById.get(id)!.rank),
  );
  const top10Def = new Set(
    [...defById.values()]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 10)
      .map((r) => r.coaster_id),
  );
  const top10Var = new Set(
    [...varById.values()]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 10)
      .map((r) => r.coaster_id),
  );
  let overlap = 0;
  for (const id of top10Var) if (top10Def.has(id)) overlap++;
  return {
    spearman,
    top10Overlap: overlap / 10,
    maxRankDelta: Math.max(...deltas),
    meanAbsRankDelta: deltas.reduce((a, b) => a + b, 0) / n,
    compared: n,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "missing bearer token" }, 401);

  if (token !== serviceKey) {
    // User JWT: validate with GoTrue, then require profiles.is_admin.
    const me = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
    });
    if (!me.ok) return json({ error: "invalid or expired token" }, 401);
    const user: { id?: string } = await me.json();
    if (!user.id) return json({ error: "invalid token subject" }, 401);
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!profile?.is_admin)
      return json({ error: "admin access required" }, 403);
  }

  const started = Date.now();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const variants = parseVariants(body.variants);
  if (typeof variants === "string") return json({ error: variants }, 400);
  const topN = clampInt(body.topN, 10, 50, 25);

  // Baseline: the production default weighting (the same RPC the board's
  // recompute uses), fitted fresh in-request so the comparison is
  // apples-to-apples with the variants rather than vs a cached board.
  const def = await fit(supabase, "pairwise_wins");
  if (typeof def === "string") return json({ error: def }, 500);

  const variantResults = [];
  for (const spec of variants) {
    const res = await fit(supabase, "pairwise_wins_custom", {
      gamma: spec.gamma,
      floor_pairs: spec.floor_pairs,
      ramp_k: spec.ramp_k,
    });
    if (typeof res === "string") return json({ error: res }, 500);
    variantResults.push({
      label:
        spec.label ??
        `γ=${spec.gamma} c=${spec.floor_pairs}${spec.ramp_k ? ` ramp=${spec.ramp_k}` : ""}`,
      params: {
        gamma: spec.gamma,
        floor_pairs: spec.floor_pairs,
        ramp_k: spec.ramp_k,
      },
      rows: res.rows,
      summary: summarize(def.rows, res.rows),
    });
  }

  return json(
    {
      default: { rows: def.rows },
      variants: variantResults,
      topN,
      durationMs: Date.now() - started,
    },
    200,
  );
});
