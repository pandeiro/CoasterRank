#!/usr/bin/env bash
#
# generate-rpc-contracts-doc.sh — snapshot the RPC contract surface into
# docs/RPC_CONTRACTS.md.
#
# Usage:  ./scripts/generate-rpc-contracts-doc.sh (from repo root)
#         npm run rpc-contracts-doc                    (from scripts/)
#
# Requires: psql, SUPABASE_DB_URL (env var or in .env at repo root).
#
# Methodology (best effort, two sources):
#   1. DATABASE HARVEST — every function in the public schema is read from
#      pg_proc (signature, defaults, return type, language, volatility,
#      security mode, EXECUTE grants, SQL comment) and grouped by its grants:
#      anon -> Public, authenticated -> Authenticated app API, service_role ->
#      pipeline/admin sections. Brand-new RPCs therefore appear automatically
#      as soon as their migration is deployed — no whitelist to update.
#   2. CODE CROSS-CHECK — literal `.rpc('name')` call sites under app/src,
#      supabase/functions and scripts/src are compared against the harvest.
#      Code-called RPCs missing from the database, and contract RPCs with no
#      static caller, are flagged in the document (and on stderr).
#
# Known limits (documented in the output, not hidden):
#   - The database knows who MAY call a function, not who DOES. Policy /
#     constraint / trigger helpers that carry callable grants are filtered by
#     name-pattern heuristics (see is_helper); a new helper that matches no
#     pattern shows up in a contract section until the pattern list grows.
#   - The code scan only resolves literal `.rpc('name')` calls. Dynamic
#     `.rpc(variable)` sites (bench harness, weight-comparison and recompute
#     Edge Functions) are listed separately as unresolvable.
#   - Descriptions come from `COMMENT ON FUNCTION` where present, else a small
#     fallback map below, else an explicit "no comment yet" marker.
#   - Mismatches are WARNINGS, never fatal: migrations deploy on merge to
#     main, so a PR that adds a caller before its migration lands must not
#     break doc generation against prod.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/docs/RPC_CONTRACTS.md"

# Prefer env var (CI sets it directly); fall back to .env for local dev.
if [ -z "${SUPABASE_DB_URL:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "Error: SUPABASE_DB_URL is not set. Provide it as an env var or in .env." >&2
  exit 1
fi

run_psql() {
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -tA "$@"
}

GENERATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
SEP="$(printf '\037')"  # unit separator: non-whitespace, so read preserves empty fields
TMP_DATA="$(mktemp)"
TMP_CODE_RPCS="$(mktemp)"
TMP_UNREF="$(mktemp)"
TMP_MISSING="$(mktemp)"
SEC_PUBLIC="$(mktemp)"
SEC_AUTH="$(mktemp)"
SEC_PIPE="$(mktemp)"
SEC_ADMIN="$(mktemp)"
SEC_EXCLUDED="$(mktemp)"
trap 'rm -f "$TMP_DATA" "$TMP_CODE_RPCS" "$TMP_UNREF" "$TMP_MISSING" "$SEC_PUBLIC" "$SEC_AUTH" "$SEC_PIPE" "$SEC_ADMIN" "$SEC_EXCLUDED"' EXIT

# ---- 1. Harvest every function in public from the live database ----
read -r -d '' RPC_QUERY <<'SQL' || true
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid),
  COALESCE(NULLIF(replace(replace(pg_get_function_arguments(p.oid), E'\n', ' '), E'\r', ' '), ''), 'none'),
  replace(replace(pg_get_function_result(p.oid), E'\n', ' '), E'\r', ' '),
  l.lanname,
  CASE p.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' WHEN 'v' THEN 'volatile' ELSE '' END,
  CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END,
  COALESCE((
    SELECT string_agg(
      CASE WHEN grant_row.grantee = 0 THEN 'PUBLIC' ELSE COALESCE(grantee_role.rolname, grant_row.grantee::text) END,
      ', ' ORDER BY CASE WHEN grant_row.grantee = 0 THEN '' ELSE COALESCE(grantee_role.rolname, grant_row.grantee::text) END
    )
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS grant_row
    LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = grant_row.grantee
    WHERE grant_row.privilege_type = 'EXECUTE'
  ), 'none'),
  replace(replace(COALESCE(obj_description(p.oid, 'pg_proc'), ''), E'\n', ' '), E'\r', ' '),
  CASE WHEN p.prorettype = 'trigger'::regtype THEN 't' ELSE 'f' END,
  CASE WHEN pg_get_function_identity_arguments(p.oid) LIKE '%internal%' THEN 't' ELSE 'f' END
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
ORDER BY p.proname, p.oid;
SQL

run_psql -F "$SEP" -c "$RPC_QUERY" > "$TMP_DATA"

# ---- 2. Static code scan: literal .rpc('name') calls ----
grep -rhoE "\.rpc\(['\"][A-Za-z0-9_]+['\"]" \
  "$REPO_ROOT/app/src" "$REPO_ROOT/supabase/functions" "$REPO_ROOT/scripts/src" 2>/dev/null \
  | sed -E "s/.*\.rpc\(['\"]([A-Za-z0-9_]+)['\"].*/\1/" \
  | sort -u > "$TMP_CODE_RPCS" || true

# Fallback descriptions for RPCs that carry no SQL comment yet. Membership is
# NEVER driven by this map — it only fills prose. Prefer adding
# `COMMENT ON FUNCTION` in a migration over extending this list.
fallback_purpose() {
  case "$1" in
    public_board_meta) printf '%s' 'Aggregate board metadata used by the public board and homepage cache.' ;;
    ranked_user_count) printf '%s' 'Legacy standalone count of users with at least one ranked ride.' ;;
    ranking_schedule) printf '%s' 'Returns the next scheduled ranking recompute times.' ;;
    coaster_ride_counts) printf '%s' 'Admin-only aggregate ride counts used by the admin coaster view.' ;;
    mark_own_submissions_seen) printf '%s' "Marks the current user's submission results as seen." ;;
    mark_own_feedback_seen) printf '%s' "Marks the current user's feedback results as seen." ;;
    materialize_guest_rides) printf '%s' "Materializes a guest's complete ranked ladder after sign-in." ;;
    log_guest_merge_decision) printf '%s' 'Records a guest merge-discard decision.' ;;
    apply_imported_rides) printf '%s' 'Atomically applies an imported ranked ladder and import telemetry.' ;;
    pairwise_wins) printf '%s' 'Builds the weighted pairwise winner/loser aggregate for fitting.' ;;
    pairwise_wins_custom) printf '%s' 'Runs pairwise aggregation with caller-selected weighting parameters for comparison runs.' ;;
    ranked_participants) printf '%s' 'Counts eligible ranked users per coaster.' ;;
    first_place_counts) printf '%s' 'Counts eligible first-place votes per coaster.' ;;
    recompute_idle_fingerprint) printf '%s' 'Detects whether ranked ride data changed since the prior recompute.' ;;
    pair_maintain_step) printf '%s' 'Processes one bounded batch of dirty users into pair totals.' ;;
    pair_fit_agg) printf '%s' 'Builds the in-database Bradley-Terry fit structures.' ;;
    pair_fit_step) printf '%s' 'Runs bounded resumable Bradley-Terry MM iterations.' ;;
    pair_fit_rows) printf '%s' 'Returns the fitted ranking rows for board upsert.' ;;
    pair_reconcile_sweep) printf '%s' 'Reconciles ride and eligibility changes into the dirty queue.' ;;
    recompute_rankings_cron) printf '%s' 'Runs the scheduled ranking recompute pipeline.' ;;
    check_stale_recompute) printf '%s' 'Runs the stale ranking and dirty-queue watchdog.' ;;
    cleanup_execution_logs) printf '%s' 'Daily TTL sweep deleting old cron execution logs.' ;;
    bt_eligible_users) printf '%s' 'Returns the set of users eligible for ranking aggregation.' ;;
    admin_user_overview) printf '%s' 'Service-role aggregate backing the admin Users view.' ;;
    admin_sharing_funnel) printf '%s' 'Service-role aggregate backing admin share-funnel metrics.' ;;
    *) printf '' ;;
  esac
}

# Policy / constraint / trigger helpers that may carry callable grants but are
# not app RPCs. Extend the patterns here when a new helper appears in a
# contract section instead of the appendix.
is_helper() {
  case "$1" in
    feedback_within_cap|submission_within_cap|submission_payload_valid|suggested_fields_keys_valid|is_admin|user_email_verified|import_stat_int|import_stat_names|send_telegram_event|telegram_safe_text|sync_primary_manufacturer|set_app_settings_updated_at|set_user_rides_updated_at|rls_auto_enable|handle_new_user|prevent_username_change|log_user_number_one|trigger_*|pair_mark_dirty_*|import_stat_*|telegram_*|sync_*|handle_*|prevent_*|*_within_cap|*_payload_valid) return 0 ;;
    *) return 1 ;;
  esac
}

# Ranking-pipeline name shapes (service_role section split).
is_ranking_name() {
  case "$1" in
    pairwise_*|pair_*|ranked_participants|first_place_counts|recompute_*|check_stale_*|cleanup_execution_logs|bt_eligible_users) return 0 ;;
    *) return 1 ;;
  esac
}

# pg_cron entry points run as postgres with no PostgREST grant; without this
# carve-out they would land in "database-internal".
is_cron_entry() {
  case "$1" in
    recompute_rankings_cron|check_stale_recompute|cleanup_execution_logs) return 0 ;;
    *) return 1 ;;
  esac
}

grants_include() {
  # $1 = grants csv, $2 = role token
  case ", $1," in
    *", $2,"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---- 3. Categorize the harvest ----
while IFS="$SEP" read -r name ident_args full_args result lang vol sec grants comment is_trigger has_internal; do
  contract_row="$name${SEP}$ident_args$SEP$full_args$SEP$result$SEP$lang$SEP$vol$SEP$sec$SEP$grants$SEP$comment"
  if [ "$lang" != "sql" ] && [ "$lang" != "plpgsql" ]; then
    printf '%s\n' "$name${SEP}Extension / internal-language function (not a PostgREST RPC)" >> "$SEC_EXCLUDED"
  elif [ "$is_trigger" = "t" ]; then
    printf '%s\n' "$name${SEP}Trigger function (returns trigger; not directly callable)" >> "$SEC_EXCLUDED"
  elif [ "$has_internal" = "t" ]; then
    printf '%s\n' "$name${SEP}Extension helper (internal arguments; not a PostgREST RPC)" >> "$SEC_EXCLUDED"
  elif is_helper "$name"; then
    printf '%s\n' "$name${SEP}Policy / constraint / trigger helper (callable grant, but not an app RPC)" >> "$SEC_EXCLUDED"
  elif grants_include "$grants" "anon" || grants_include "$grants" "PUBLIC"; then
    printf '%s\n' "$contract_row" >> "$SEC_PUBLIC"
  elif grants_include "$grants" "authenticated"; then
    printf '%s\n' "$contract_row" >> "$SEC_AUTH"
  elif grants_include "$grants" "service_role"; then
    if is_ranking_name "$name"; then
      printf '%s\n' "$contract_row" >> "$SEC_PIPE"
    else
      printf '%s\n' "$contract_row" >> "$SEC_ADMIN"
    fi
  elif is_cron_entry "$name"; then
    printf '%s\n' "$contract_row" >> "$SEC_PIPE"
  else
    printf '%s\n' "$name${SEP}Database-internal (no anon / authenticated / service_role grant)" >> "$SEC_EXCLUDED"
  fi
done < "$TMP_DATA"

# ---- 4. Helpers for the code cross-check ----
rpc_call_files() {
  grep -rln --include='*.ts' --include='*.tsx' --include='*.mts' -E "\.rpc\(['\"]$1['\"]" \
    "$REPO_ROOT/app/src" "$REPO_ROOT/supabase/functions" "$REPO_ROOT/scripts/src" 2>/dev/null \
    | sed "s|$REPO_ROOT/||" | sort || true
}

pipeline_ref_files() {
  {
    grep -rln --include='*.ts' --include='*.tsx' --include='*.mts' -w "$1" \
      "$REPO_ROOT/supabase/functions" "$REPO_ROOT/scripts/src" 2>/dev/null || true
    grep -ln "public\.$1(" "$REPO_ROOT/supabase/migrations/"*.sql 2>/dev/null || true
  } | sed "s|$REPO_ROOT/||" | sort -u || true
}

format_refs() {
  if [ -z "$1" ]; then
    printf '—'
  else
    printf '%s' "$1" | head -6 | sed 's/^/`/;s/$/`/' | paste -sd',' - | sed 's/,/, /g'
  fi
}

db_has_function() {
  grep -q "^$1$SEP" "$TMP_DATA"
}

# ---- 5. Render one contract block; records unreferenced RPCs ----
print_function_block() {
  # $1 = tsv line (name, ident_args, full_args, result, lang, vol, sec, grants, comment)
  # $2 = ref kind: rpc | pipeline
  # $3 = "cron" when the function is a pg_cron entry point
  IFS="$SEP" read -r name ident_args full_args result lang vol sec grants comment <<< "$1"
  signature="public.$name($ident_args)"

  if [ -n "$comment" ]; then
    desc="$comment"
  else
    desc="$(fallback_purpose "$name")"
    if [ -z "$desc" ]; then
      desc="_No database comment yet._"
    fi
  fi

  if [ "$2" = "pipeline" ]; then
    refs="$(pipeline_ref_files "$name")"
    if [ -z "$refs" ] && [ "$3" = "cron" ]; then
      refs_cell='`pg_cron schedule`'
    elif [ -n "$refs" ] && [ "$3" = "cron" ]; then
      refs_cell="$(format_refs "$refs"), \`pg_cron schedule\`"
    else
      refs_cell="$(format_refs "$refs")"
    fi
    refs_label="Invoked by"
  else
    refs="$(rpc_call_files "$name")"
    refs_cell="$(format_refs "$refs")"
    refs_label="Called by (\`.rpc\`)"
  fi

  printf '### `%s`\n\n' "$signature"
  printf '%s\n\n' "$desc"
  printf '| Property | Contract |\n|----------|----------|\n'
  printf '| Arguments | `%s` |\n' "$full_args"
  printf '| Returns | `%s` |\n' "$result"
  printf '| Language | `%s` |\n' "$lang"
  printf '| Volatility | `%s` |\n' "$vol"
  printf '| Security | `%s` |\n' "$sec"
  printf '| Execute grants | `%s` |\n' "$grants"
  printf '| %s | %s |\n\n' "$refs_label" "$refs_cell"

  if [ -z "$refs" ] && [ "$3" != "cron" ]; then
    printf '%s\n' "$name" >> "$TMP_UNREF"
    # shellcheck disable=SC2016
    printf '_⚠ Not referenced by any static `.rpc('"'%s'"')` call in the repo — verify the caller or tighten the grant._\n\n' "$name"
  fi
}

print_section() {
  # $1 = file, $2 = ref kind, $3 = cron-name list ("a b c" or empty)
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    name="${line%%"$SEP"*}"
    cron_flag=""
    case " $3 " in
      *" $name "*) cron_flag="cron" ;;
    esac
    print_function_block "$line" "$2" "$cron_flag"
  done < "$1"
}

CRON_NAMES="recompute_rankings_cron check_stale_recompute cleanup_execution_logs"

# ---- 6. Emit the document ----
{
  printf '# CoasterRank RPC Contracts\n\n'
  printf '> Auto-generated by `scripts/generate-rpc-contracts-doc.sh`.\n'
  printf '> Generated: %s\n>\n' "$GENERATED_AT"
  printf '> **To regenerate:** `cd scripts && npm run rpc-contracts-doc`\n\n'
  printf 'Function inventory is harvested from the live database (`pg_proc`), grouped by `EXECUTE` grants. Membership is automatic: a newly deployed RPC appears here as soon as its migration lands. Descriptions prefer `COMMENT ON FUNCTION`, then a small fallback map in the generator.\n\n'
  printf '## Reading This Document\n\n'
  printf -- '- **Execute grants** are the database roles allowed to call the function through PostgREST.\n'
  printf -- '- **Security** is the PostgreSQL execution mode: `definer` runs with the function owner\x27s privileges; `invoker` runs with the caller\x27s privileges.\n'
  printf -- '- The signature shows identity arguments (defaults omitted); the Arguments row shows the full declaration with defaults.\n'
  printf -- '- **Called by** lists repo files with a literal `.rpc('"'"'name'"'"')` call. **Invoked by** (pipeline sections) lists Edge Function / script / migration references plus the `pg_cron schedule` marker.\n\n'

  printf '## Public / anonymous API\n\n'
  printf 'Callable without authentication (`anon` grant). Every addition here widens the unauthenticated attack surface — review carefully.\n\n'
  print_section "$SEC_PUBLIC" "rpc" ""

  printf '## Authenticated app API\n\n'
  printf 'Callable by any signed-in user. Mutating RPCs must enforce ownership and caps server-side.\n\n'
  print_section "$SEC_AUTH" "rpc" ""

  printf '## Ranking / recompute pipeline\n\n'
  printf 'Service-role RPCs plus `pg_cron` entry points (postgres-only grant, invoked by schedule). Not reachable from browsers; they power the Bradley-Terry pipeline and its watchdogs.\n\n'
  print_section "$SEC_PIPE" "pipeline" "$CRON_NAMES"

  printf '## Admin / service RPCs\n\n'
  printf 'Service-role RPCs consumed by Edge Functions or ops tooling. Not reachable from browsers.\n\n'
  print_section "$SEC_ADMIN" "pipeline" ""

  printf '## Usage cross-check (best effort)\n\n'
  printf 'Static scan of literal `.rpc('"'"'name'"'"')` calls under `app/src`, `supabase/functions` and `scripts/src`, compared against the harvested inventory.\n\n'

  : > "$TMP_MISSING"
  while IFS= read -r code_name; do
    [ -z "$code_name" ] && continue
    if ! db_has_function "$code_name"; then
      printf '%s\n' "$code_name" >> "$TMP_MISSING"
    fi
  done < "$TMP_CODE_RPCS"

  if [ -s "$TMP_MISSING" ]; then
    printf '### ⚠ Called in code, missing from the database\n\n'
    while IFS= read -r missing; do
      [ -z "$missing" ] && continue
      printf -- '- `%s` — called by %s\n' "$missing" "$(format_refs "$(rpc_call_files "$missing")")"
    done < "$TMP_MISSING"
    printf '\n'
  else
    printf '### Called in code, missing from the database\n\nNone — every static `.rpc()` call resolves to a harvested function.\n\n'
  fi

  if [ -s "$TMP_UNREF" ]; then
    printf '### Contract RPCs with no static caller\n\n'
    printf 'These are harvested but have no literal `.rpc()` call in the repo. Expected for cron entries and dynamic-call targets; otherwise verify the caller still exists.\n\n'
    sort -u "$TMP_UNREF" | while IFS= read -r unref; do
      [ -z "$unref" ] && continue
      printf -- '- `%s`\n' "$unref"
    done
    printf '\n'
  else
    printf '### Contract RPCs with no static caller\n\nNone.\n\n'
  fi

  printf '### Dynamic `.rpc()` call sites (not statically resolvable)\n\n'
  DYNAMIC_SITES="$(grep -rln --include='*.ts' --include='*.tsx' --include='*.mts' -E "\.rpc\( *[^'\" ]" \
    "$REPO_ROOT/app/src" "$REPO_ROOT/supabase/functions" "$REPO_ROOT/scripts/src" 2>/dev/null \
    | sed "s|$REPO_ROOT/||" | sort || true)"
  if [ -z "$DYNAMIC_SITES" ]; then
    printf 'None.\n\n'
  else
    printf 'The cross-check cannot resolve function names at these call sites — verify them by hand when the inventory changes:\n\n'
    printf '%s' "$DYNAMIC_SITES" | sed 's/^/- `/' | sed 's/$/`/'
    printf '\n\n'
  fi

  printf '## Excluded from contracts\n\n'
  printf 'Harvested functions intentionally left out of the contract sections, with reasons. A new function lands here (never silently dropped) when it matches an exclusion heuristic — promote it to a contract section by fixing grants or extending the generator.\n\n'
  printf '| Function | Reason |\n|----------|--------|\n'
  while IFS="$SEP" read -r name reason; do
    [ -z "$name" ] && continue
    printf '| `%s` | %s |\n' "$name" "$reason"
  done < "$SEC_EXCLUDED"
  printf '\n'
} > "$OUT"

# ---- 7. stderr summary (warnings, never fatal) ----
N_PUB="$(grep -c . "$SEC_PUBLIC" || true)"
N_AUTH="$(grep -c . "$SEC_AUTH" || true)"
N_PIPE="$(grep -c . "$SEC_PIPE" || true)"
N_ADMIN="$(grep -c . "$SEC_ADMIN" || true)"
N_EXCL="$(grep -c . "$SEC_EXCLUDED" || true)"
echo "Wrote RPC contracts to $OUT (public=$N_PUB auth=$N_AUTH pipeline=$N_PIPE admin=$N_ADMIN excluded=$N_EXCL)"
if [ -s "$TMP_MISSING" ]; then
  echo "Warning: code-called RPCs missing from the database:" >&2
  sed 's/^/  - /' "$TMP_MISSING" >&2
fi
if [ -s "$TMP_UNREF" ]; then
  echo "Warning: contract RPCs with no static caller:" >&2
  sort -u "$TMP_UNREF" | sed 's/^/  - /' >&2
fi
