import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchUsFuelMix, normalizeUsMonthlyCoalRecord } from "../connectors/us-eia.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const envPath = resolve(projectRoot, ".env");
const START_YEAR = 2026;
const START_MONTH_INDEX = 0;

const loadDotEnv = () => {
  try {
    const file = readFileSync(envPath, "utf8");
    const lines = file.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");

      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");

      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
};

const buildMonthlyWindows = () => {
  const windows = [];
  const now = new Date();
  const endYear = now.getUTCFullYear();
  const endMonthIndex = now.getUTCMonth();

  for (let year = START_YEAR; year <= endYear; year += 1) {
    const monthStart = year === START_YEAR ? START_MONTH_INDEX : 0;
    const monthEnd = year === endYear ? endMonthIndex : 11;

    for (let monthIndex = monthStart; monthIndex <= monthEnd; monthIndex += 1) {
      const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
      const naturalEnd = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59));
      const isCurrentMonth = year === endYear && monthIndex === endMonthIndex;
      const end = isCurrentMonth ? now : naturalEnd;
      windows.push({ start, end, isCurrentMonth });
    }
  }

  return windows;
};

loadDotEnv();

const apiKey = process.env.EIA_API_KEY;

if (!apiKey) {
  console.error("Missing EIA_API_KEY. Add it to .env or export it in your shell, then rerun this script.");
  process.exit(1);
}

let persisted = 0;
let skipped = 0;

for (const window of buildMonthlyWindows()) {
  try {
    const { rows } = await fetchUsFuelMix(apiKey, fetch, {
      start: window.start,
      end: window.end,
      length: 20000,
    });

    const record = normalizeUsMonthlyCoalRecord(rows, new Date().toISOString(), {
      isPartialMonth: window.isCurrentMonth,
      length: 20000,
    });

    await persistSnapshot({ connector: "us-eia-monthly", record });
    persisted += 1;
    console.log(`US monthly backfill: stored ${record.observedAt}`);
  } catch (error) {
    skipped += 1;
    console.warn(
      `US monthly backfill: skipped ${window.start.toISOString()} to ${window.end.toISOString()} - ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

console.log(`US monthly backfill complete. Stored ${persisted} months, skipped ${skipped}.`);
