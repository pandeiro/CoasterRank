import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXT_DIR = path.join(REPO_ROOT, "data", "ext");
const OUTPUT_FILE = path.join(EXT_DIR, "all_coasters_combined.txt");

function normalize(name: string): string {
  let n = name.trim();
  n = n.replace(/[’‘]/g, "'").replace(/[""]/g, '"');
  if (n.toLowerCase().startsWith("the ")) n = n.slice(4);
  if (n.toLowerCase().startsWith("jurassic world ")) n = n.slice(15);
  if (n.toLowerCase() === "voltron nevera") n = "Voltron";
  if (n.toLowerCase() === "boulderdash") n = "Boulder Dash";
  if (n.toLowerCase() === "wodan") n = "Wodan Timbur Coaster";
  if (n.toLowerCase() === "the legend") n = "Legend";
  if (n.toLowerCase() === "the beast") n = "Beast";
  if (n.toLowerCase() === "the voyage") n = "Voyage";
  if (n.toLowerCase() === "the raven") n = "Raven";
  if (n.toLowerCase() === "the boss") n = "Boss";
  if (n.toLowerCase() === "colossos") n = "Colossos - Kampf der Giganten";
  if (n.toLowerCase() === "playland wooden coaster") n = "Coaster";
  return n.toLowerCase();
}

function extractSteel(filepath: string): [string, string][] {
  const html = fs.readFileSync(filepath, "utf-8");
  const $ = load(html);
  const pairs: [string, string][] = [];
  $("table tbody tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length >= 3) {
      const rank = $(tds[0]).text().trim();
      if (rank && rank !== "Rank") {
        const coaster = $(tds[1]).text().trim();
        const park = $(tds[2]).text().trim();
        if (coaster && park) {
          pairs.push([coaster, park]);
        }
      }
    }
  });
  return pairs;
}

function extractWooden(filepath: string): [string, string][] {
  const html = fs.readFileSync(filepath, "utf-8");
  const $ = load(html);
  const pairs: [string, string][] = [];
  $("table tbody tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length >= 3) {
      const rank = $(tds[0]).text().trim();
      if (rank && rank !== "Rank") {
        const coaster = $(tds[1]).text().trim();
        const park = $(tds[2]).text().trim();
        if (coaster && park) {
          pairs.push([coaster, park]);
        }
      }
    }
  });
  return pairs;
}

function extractVote(filepath: string): [string, string][] {
  const html = fs.readFileSync(filepath, "utf-8");
  const $ = load(html);
  const pairs: [string, string][] = [];
  $("#myTable tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length >= 3) {
      const first = $(tds[0]).text().trim();
      if (/^\d+$/.test(first)) {
        const coaster = $(tds[1]).text().trim();
        const park = $(tds[2]).text().trim();
        if (coaster && park) {
          pairs.push([coaster, park]);
        }
      }
    }
  });
  return pairs;
}

function formatPair(coaster: string, park: string): string {
  return `${coaster} - ${park}`;
}

function main() {
  const steelPairs = extractSteel(path.join(EXT_DIR, "golden.ticket.steel.2025.html"));
  const woodenPairs = extractWooden(path.join(EXT_DIR, "golden.ticket.wooden.2025.html"));
  const votePairs = extractVote(path.join(EXT_DIR, "votecoasters.2024.html"));

  console.log(`Steel: ${steelPairs.length}`);
  console.log(`Wooden: ${woodenPairs.length}`);
  console.log(`Vote: ${votePairs.length}`);

  const allPairs = new Map<string, [string, string]>();

  for (const [coaster, park] of votePairs) {
    const key = normalize(coaster);
    if (!allPairs.has(key)) allPairs.set(key, [coaster, park]);
  }
  for (const [coaster, park] of steelPairs) {
    const key = normalize(coaster);
    if (!allPairs.has(key)) allPairs.set(key, [coaster, park]);
  }
  for (const [coaster, park] of woodenPairs) {
    const key = normalize(coaster);
    if (!allPairs.has(key)) allPairs.set(key, [coaster, park]);
  }

  const sorted = Array.from(allPairs.entries()).sort((a, b) =>
    a[1][0].toLowerCase().localeCompare(b[1][0].toLowerCase())
  );

  const outputLines = sorted.map(([, [coaster, park]]) => formatPair(coaster, park));
  fs.writeFileSync(OUTPUT_FILE, outputLines.join("\n") + "\n");
  console.log(`\nTotal unique (normalized): ${sorted.length}`);
  console.log(`Written to: ${OUTPUT_FILE}`);

  const voteKeys = new Set(votePairs.map(([c]) => normalize(c)));
  const steelKeys = new Set(steelPairs.map(([c]) => normalize(c)));
  const steelAdded = steelPairs.filter(([c]) => !voteKeys.has(normalize(c)));
  const woodenAdded = woodenPairs.filter(
    ([c]) => !voteKeys.has(normalize(c)) && !steelKeys.has(normalize(c))
  );
  console.log(`\nAdded from Steel (not in Vote): ${steelAdded.length}`);
  steelAdded.forEach(([c, p]) => console.log(`  + ${formatPair(c, p)}`));
  console.log(`\nAdded from Wooden (not in Vote/Steel): ${woodenAdded.length}`);
  woodenAdded.forEach(([c, p]) => console.log(`  + ${formatPair(c, p)}`));
}

main();