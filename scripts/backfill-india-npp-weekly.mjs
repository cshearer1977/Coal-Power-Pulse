import { fetchIndiaNppGeneration, normalizeIndiaThermalRecord } from "../connectors/india-npp.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const START_DATE = new Date("2026-01-01T00:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const buildWeeklyDates = (startDate, endDate = new Date()) => {
  const dates = [];

  for (let cursor = startDate.getTime(); cursor <= endDate.getTime(); cursor += WEEK_MS) {
    dates.push(new Date(cursor));
  }

  return dates;
};

const dates = buildWeeklyDates(START_DATE);

let persisted = 0;
let skipped = 0;

for (const date of dates) {
  try {
    const { rows } = await fetchIndiaNppGeneration(date);
    const record = normalizeIndiaThermalRecord(rows, new Date().toISOString());
    await persistSnapshot({ connector: "india-npp", record, isProxy: true });
    persisted += 1;
    console.log(`India weekly backfill: stored ${record.observedAt}`);
  } catch (error) {
    skipped += 1;
    console.warn(
      `India weekly backfill: skipped ${date.toISOString().slice(0, 10)} - ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

console.log(`India weekly backfill complete. Stored ${persisted} weeks, skipped ${skipped}.`);
