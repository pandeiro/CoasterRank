import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", "..", ".env") });
const PARK_ALIASES_FILE = join(__dirname, "..", "..", "data", "coverage", "park-aliases.json");
const PARK_ALIASES: Record<string, string> = existsSync(PARK_ALIASES_FILE)
  ? (JSON.parse(readFileSync(PARK_ALIASES_FILE, "utf-8")) as Record<string, string>)
  : {};

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const DEDUPED_FILE = join(__dirname, "..", "..", "data", "ext", "top_coasters.txt");
const REPORT_FILE = join(__dirname, "..", "..", "data", "ext", "coverage_report.txt");

interface Entry {
  coaster: string;
  park: string;
  lineNum: number;
}

interface MatchResult {
  parkId: string | null;
  parkName: string | null;
  parkSlug: string | null;
  parkSim: number;
  coasterId: string | null;
  coasterName: string | null;
  coasterSim: number;
  notes: string[];
}

async function findParkExactByName(
  parkName: string,
): Promise<{ id: string; name: string; slug: string; sim: number } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, name, slug
       FROM parks
       WHERE lower(name) = lower($1)
       LIMIT 1`,
      [parkName],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return { id: row.id, name: row.name, slug: row.slug, sim: 1 };
  } finally {
    client.release();
  }
}

function parseEntries(text: string): Entry[] {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.map((line, i) => {
    const lastSep = line.lastIndexOf(" - ");
    if (lastSep === -1) return { coaster: line.trim(), park: "", lineNum: i + 1 };
    return {
      coaster: line.substring(0, lastSep).trim(),
      park: line.substring(lastSep + 3).trim(),
      lineNum: i + 1,
    };
  });
}

async function findPark(parkName: string): Promise<{ id: string; name: string; slug: string; sim: number } | null> {
  const aliasName = PARK_ALIASES[parkName];
  if (aliasName) {
    const aliasMatch = await findParkExactByName(aliasName);
    if (aliasMatch) return aliasMatch;
  }

  const exactMatch = await findParkExactByName(parkName);
  if (exactMatch) return exactMatch;

  const client = await pool.connect();
  try {
    // pg_trgm similarity - works character-level, much better than word overlap
    const res = await client.query(
      `SELECT id, name, slug, similarity(name, $1) as sim
       FROM parks
       WHERE similarity(name, $1) > 0.3
       ORDER BY sim DESC
       LIMIT 1`,
      [parkName]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return { id: row.id, name: row.name, slug: row.slug, sim: parseFloat(row.sim) };
  } finally {
    client.release();
  }
}

async function findCoasterAtPark(
  coasterName: string,
  parkId: string
): Promise<{ id: string; name: string; sim: number } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, name, similarity(name, $1) as sim
       FROM coasters
       WHERE park_id = $2 AND similarity(name, $1) > 0.3
       ORDER BY sim DESC
       LIMIT 1`,
      [coasterName, parkId]
    );
    if (res.rows.length === 0) return null;
    return { id: res.rows[0].id, name: res.rows[0].name, sim: parseFloat(res.rows[0].sim) };
  } finally {
    client.release();
  }
}

async function findCoasterGlobally(
  coasterName: string
): Promise<{ id: string; name: string; parkName: string; sim: number } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT c.id, c.name, p.name as park_name, similarity(c.name, $1) as sim
       FROM coasters c
       JOIN parks p ON p.id = c.park_id
       WHERE similarity(c.name, $1) > 0.4
       ORDER BY sim DESC
       LIMIT 1`,
      [coasterName]
    );
    if (res.rows.length === 0) return null;
    return {
      id: res.rows[0].id,
      name: res.rows[0].name,
      parkName: res.rows[0].park_name,
      sim: parseFloat(res.rows[0].sim),
    };
  } finally {
    client.release();
  }
}

async function checkEntry(entry: Entry): Promise<MatchResult> {
  const notes: string[] = [];
  let parkId: string | null = null;
  let parkName: string | null = null;
  let parkSlug: string | null = null;
  let parkSim = 0;
  let coasterId: string | null = null;
  let coasterName: string | null = null;
  let coasterSim = 0;

  // 1. Find park via pg_trgm
  const parkMatch = await findPark(entry.park);
  if (parkMatch) {
    parkId = parkMatch.id;
    parkName = parkMatch.name;
    parkSlug = parkMatch.slug;
    parkSim = parkMatch.sim;
    if (parkMatch.sim >= 0.95) {
      notes.push(`Park exact: "${entry.park}" → "${parkMatch.name}"`);
    } else {
      notes.push(`Park fuzzy (${parkMatch.sim.toFixed(2)}): "${entry.park}" → "${parkMatch.name}"`);
    }
  } else {
    notes.push(`Park NOT FOUND: "${entry.park}"`);
  }

  // 2. Find coaster at matched park
  if (parkId) {
    const coasterMatch = await findCoasterAtPark(entry.coaster, parkId);
    if (coasterMatch) {
      coasterId = coasterMatch.id;
      coasterName = coasterMatch.name;
      coasterSim = coasterMatch.sim;
      if (coasterMatch.sim >= 0.95) {
        notes.push(`Coaster exact: "${entry.coaster}" → "${coasterMatch.name}"`);
      } else {
        notes.push(
          `Coaster fuzzy (${coasterMatch.sim.toFixed(2)}) at ${parkName}: "${entry.coaster}" → "${coasterMatch.name}"`
        );
      }
    } else {
      // Check if it exists at a different park
      const global = await findCoasterGlobally(entry.coaster);
      if (global && global.sim >= 0.7) {
        notes.push(
          `Coaster NOT at ${parkName} but found at ${global.parkName} (sim ${global.sim.toFixed(2)}): "${global.name}"`
        );
      } else {
        notes.push(`Coaster NOT FOUND at ${parkName}: "${entry.coaster}"`);
      }
    }
  }

  return {
    parkId, parkName, parkSlug, parkSim,
    coasterId, coasterName, coasterSim,
    notes,
  };
}

async function main() {
  console.log("Loading external list...");
  const text = readFileSync(DEDUPED_FILE, "utf-8");
  const entries = parseEntries(text);
  console.log(`  Parsed ${entries.length} entries`);

  const { rows: [{ count: parkCount }] } = await pool.query("SELECT count(*)::int as count FROM parks");
  const { rows: [{ count: coasterCount }] } = await pool.query("SELECT count(*)::int as count FROM coasters");
  console.log(`  DB parks: ${parkCount}, coasters: ${coasterCount}`);

  console.log("Checking coverage...\n");

  const results: { entry: Entry; result: MatchResult }[] = [];
  for (const entry of entries) {
    const result = await checkEntry(entry);
    results.push({ entry, result });
    if (results.length % 50 === 0) console.log(`  ${results.length}/${entries.length}...`);
  }

  // Stats
  const found = results.filter((r) => r.result.coasterId);
  const parkOnly = results.filter((r) => r.result.parkId && !r.result.coasterId);
  const parkMissing = results.filter((r) => !r.result.parkId);
  const exactCoaster = found.filter((r) => r.result.coasterSim >= 0.95);
  const fuzzyCoaster = found.filter((r) => r.result.coasterSim < 0.95);

  const externalParks = new Set(entries.map((e) => e.park.toLowerCase()));
  const uniqueParkMissing = [...new Set(parkMissing.map((r) => r.entry.park))];

  const lines: string[] = [];
  lines.push("=".repeat(70));
  lines.push("  COASTER RANK — EXTERNAL DATA COVERAGE REPORT");
  lines.push("  Generated: " + new Date().toISOString());
  lines.push("=".repeat(70));
  lines.push("");
  lines.push("━━━ SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`  External list entries:     ${entries.length}`);
  lines.push(`  DB parks:                  ${parkCount}`);
  lines.push(`  DB coasters:               ${coasterCount}`);
  lines.push("");
  lines.push(`  External unique parks:     ${externalParks.size}`);
  lines.push(`  Parks MISSING from DB:     ${uniqueParkMissing.length}`);
  lines.push("");
  lines.push(`  ✅ Coaster found (exact):  ${exactCoaster.length}`);
  lines.push(`  ✅ Coaster found (fuzzy):  ${fuzzyCoaster.length}`);
  lines.push(`  ✅ Coaster found (total):  ${found.length} / ${entries.length} (${((found.length / entries.length) * 100).toFixed(1)}%)`);
  lines.push(`  ⚠️  Park found, coaster missing: ${parkOnly.length}`);
  lines.push(`  ❌ Park not found:         ${parkMissing.length}`);
  lines.push("");

  if (uniqueParkMissing.length > 0) {
    lines.push("━━━ PARKS NOT IN DB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    for (const p of uniqueParkMissing) {
      lines.push(`  • ${p}`);
    }
    lines.push("");
  }

  // Issues
  const issues = results.filter(
    (r) => !r.result.parkId || !r.result.coasterId || r.result.coasterSim < 0.95 || r.result.parkSim < 0.95
  );

  lines.push("━━━ DETAILED ISSUE LOG ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`  ${issues.length} entries need attention\n`);

  for (const { entry, result } of issues) {
    const icon = !result.parkId ? "❌" : !result.coasterId ? "⚠️" : "🔍";
    lines.push(`  ${icon} [L${entry.lineNum}] ${entry.coaster} @ ${entry.park}`);
    for (const note of result.notes) {
      lines.push(`      ${note}`);
    }
    lines.push("");
  }

  lines.push("=".repeat(70));
  lines.push(`  ${exactCoaster.length} exact + ${fuzzyCoaster.length} fuzzy = ${found.length} matched out of ${entries.length}`);
  lines.push(`  Coverage: ${((found.length / entries.length) * 100).toFixed(1)}%`);
  lines.push("=".repeat(70));

  const report = lines.join("\n");
  writeFileSync(REPORT_FILE, report);
  console.log(report);
  console.log(`\nReport written to: ${REPORT_FILE}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
