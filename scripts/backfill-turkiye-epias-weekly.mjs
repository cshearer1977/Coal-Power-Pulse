import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchEpiasRealtimeGeneration,
  normalizeTurkiyeCoalRecord,
} from "../connectors/turkiye-epias.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const envPath = resolve(projectRoot, ".env");
const START_DATE = new Date("2026-01-01T00:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

const buildWeeklyDates = (startDate, endDate = new Date()) => {
  const dates = [];

  for (let cursor = startDate.getTime(); cursor <= endDate.getTime(); cursor += WEEK_MS) {
    dates.push(new Date(cursor));
  }

  return dates;
};

loadDotEnv();

const username = process.env.EPIAS_USERNAME;
const password = process.env.EPIAS_PASSWORD;

if (!username || !password) {
  console.error("Missing EPIAS_USERNAME or EPIAS_PASSWORD. Add them to .env, then rerun this script.");
  process.exit(1);
}

const dates = buildWeeklyDates(START_DATE);

let persisted = 0;
let skipped = 0;

for (const date of dates) {
  try {
    const { payload } = await fetchEpiasRealtimeGeneration({ username, password, date });
    const record = normalizeTurkiyeCoalRecord(payload, new Date().toISOString());
    await persistSnapshot({ connector: "turkiye-epias", record });
    persisted += 1;
    console.log(`Turkiye weekly backfill: stored ${record.observedAt}`);
  } catch (error) {
    skipped += 1;
    console.warn(
      `Turkiye weekly backfill: skipped ${date.toISOString().slice(0, 10)} - ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

console.log(`Turkiye weekly backfill complete. Stored ${persisted} weeks, skipped ${skipped}.`);
