import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXT_DIR = path.join(REPO_ROOT, "data", "ext");
const OUTPUT_FILE = path.join(EXT_DIR, "golden_ticket_2025_combined_extracted.txt");

function extractGoldenTicket(filepath: string): [string, string][] {
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

function formatPair(coaster: string, park: string): string {
  return `${coaster} - ${park}`;
}

function main() {
  const steelPairs = extractGoldenTicket(path.join(EXT_DIR, "golden.ticket.steel.2025.html"));
  const woodenPairs = extractGoldenTicket(path.join(EXT_DIR, "golden.ticket.wooden.2025.html"));

  console.log(`Steel: ${steelPairs.length}`);
  console.log(`Wooden: ${woodenPairs.length}`);

  const allPairs = [...steelPairs, ...woodenPairs];
  const outputLines = allPairs.map(([coaster, park]) => formatPair(coaster, park));
  fs.writeFileSync(OUTPUT_FILE, outputLines.join("\n") + "\n");
  console.log(`Total: ${allPairs.length}`);
  console.log(`Written to: ${OUTPUT_FILE}`);
}

main();