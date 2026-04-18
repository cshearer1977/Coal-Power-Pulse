import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchBrazilOnsGeneration,
  normalizeBrazilCoalRecordForRange
} from "../connectors/brazil-ons.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const START_DATE = new Date("2026-01-01T00:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const buildWeeklyWindows = (startDate, endDate = new Date()) => {
  const windows = [];

  for (let cursor = startDate.getTime(); cursor <= endDate.getTime(); cursor += WEEK_MS) {
    const start = new Date(cursor);
    const end = new Date(Math.min(cursor + WEEK_MS - 1, endDate.getTime()));
    windows.push({ start, end });
  }

  return windows;
};

const getMonthKey = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

const windows = buildWeeklyWindows(START_DATE);
const monthCache = new Map();

let persisted = 0;
let skipped = 0;

for (const window of windows) {
  const monthKey = getMonthKey(window.start);

  try {
    let monthEntry = monthCache.get(monthKey);

    if (!monthEntry) {
      monthEntry = await fetchBrazilOnsGeneration(window.start);
      monthCache.set(monthKey, monthEntry);
    }

    const record = normalizeBrazilCoalRecordForRange(
      monthEntry.csv,
      {
        start: window.start.toISOString(),
        end: window.end.toISOString()
      },
      new Date().toISOString()
    );

    await persistSnapshot({ connector: "brazil-ons", record });
    persisted += 1;
    console.log(`Brazil weekly backfill: stored ${record.observedAt}`);
  } catch (error) {
    skipped += 1;
    console.warn(
      `Brazil weekly backfill: skipped ${window.start.toISOString()} to ${window.end.toISOString()} - ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

console.log(`Brazil weekly backfill complete. Stored ${persisted} weeks, skipped ${skipped}.`);
