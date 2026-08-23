import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXT_DIR = path.join(REPO_ROOT, "data", "ext");
const OUTPUT_FILE = path.join(EXT_DIR, "votecoasters_2024_extracted.txt");

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
  const votePairs = extractVote(path.join(EXT_DIR, "votecoasters.2024.html"));

  console.log(`Vote: ${votePairs.length}`);

  const outputLines = votePairs.map(([coaster, park]) => formatPair(coaster, park));
  fs.writeFileSync(OUTPUT_FILE, outputLines.join("\n") + "\n");
  console.log(`Written to: ${OUTPUT_FILE}`);
}

main();