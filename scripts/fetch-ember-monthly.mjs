import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchEmberMonthlyCoalSeries,
  normalizeEmberMonthlyCoalSeries,
  summarizeEmberMarkets,
} from "../connectors/ember-monthly.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputPath = resolve(projectRoot, "data/ember-monthly-series.json");
const envPath = resolve(projectRoot, ".env");

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

loadDotEnv();

const apiKey = process.env.EMBER_API_KEY;

if (!apiKey) {
  console.error("Missing EMBER_API_KEY. Add it to .env or export it in your shell, then rerun this script.");
  process.exit(1);
}

const redactApiKey = (url) => url.replace(apiKey, "{EMBER_API_KEY}");

try {
  const fetchedAt = new Date().toISOString();
  const { startDate, endDate, url, rows } = await fetchEmberMonthlyCoalSeries(apiKey);
  const records = normalizeEmberMonthlyCoalSeries(rows, fetchedAt, redactApiKey(url)).map((record) => ({
    ...record,
    sourceUrl: redactApiKey(record.sourceUrl),
  }));

  for (const record of records) {
    await persistSnapshot({ connector: "ember-monthly", record });
  }

  const monthlyRows = records
    .map((record) => ({
      market: record.market,
      bucket_start: `${record.observedAt.slice(0, 7)}-01`,
      observed_at: record.observedAt,
      coal_generation_mwh: record.coalGenerationMwh,
      coal_share_pct: record.coalSharePct,
      total_generation_mwh: record.totalGenerationMw,
      source: record.source,
      source_family: "Ember",
      source_label: "Ember API",
      connector: "ember-monthly",
      is_proxy: false,
    }))
    .sort((a, b) => a.market.localeCompare(b.market) || a.bucket_start.localeCompare(b.bucket_start));

  const markets = summarizeEmberMarkets(rows);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
        {
          generatedAt: fetchedAt,
          period: "monthly",
          startDate,
          endDate,
          marketCount: markets.length,
          markets,
          rows: monthlyRows,
        },
        null,
        2
    )}\n`
  );

  console.log(`Wrote ${outputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
