import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchUsFuelMix, normalizeUsWeeklyCoalRecord } from "../connectors/us-eia.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const envPath = resolve(projectRoot, ".env");
const START_DATE = new Date("2026-01-01T00:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

const buildWeeklyWindows = (startDate, endDate = new Date()) => {
  const windows = [];

  for (let cursor = startDate.getTime(); cursor <= endDate.getTime(); cursor += WEEK_MS) {
    const start = new Date(cursor);
    const end = new Date(Math.min(cursor + WEEK_MS - 1, endDate.getTime()));
    windows.push({ start, end });
  }

  return windows;
};

const buildDailyWindows = (startDate, endDate) => {
  const windows = [];

  for (let cursor = startDate.getTime(); cursor <= endDate.getTime(); cursor += DAY_MS) {
    const start = new Date(cursor);
    const end = new Date(Math.min(cursor + DAY_MS - 1, endDate.getTime()));
    windows.push({ start, end });
  }

  return windows;
};

loadDotEnv();

const apiKey = process.env.EIA_API_KEY;

if (!apiKey) {
  console.error("Missing EIA_API_KEY. Add it to .env or export it in your shell, then rerun this script.");
  process.exit(1);
}

const windows = buildWeeklyWindows(START_DATE);

let persisted = 0;
let skipped = 0;

for (const window of windows) {
  try {
    const dailyWindows = buildDailyWindows(window.start, window.end);
    const rows = [];

    for (const dayWindow of dailyWindows) {
      const response = await fetchUsFuelMix(apiKey, fetch, {
        start: dayWindow.start,
        end: dayWindow.end,
        length: 1000
      });
      rows.push(...response.rows);
    }

    const record = normalizeUsWeeklyCoalRecord(rows, new Date().toISOString(), {
      length: 1000,
    });
    await persistSnapshot({ connector: "us-eia-weekly", record });
    persisted += 1;
    console.log(`US weekly backfill: stored ${record.observedAt}`);
  } catch (error) {
    skipped += 1;
    console.warn(
      `US weekly backfill: skipped ${window.start.toISOString()} to ${window.end.toISOString()} - ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

console.log(`US weekly backfill complete. Stored ${persisted} weeks, skipped ${skipped}.`);
