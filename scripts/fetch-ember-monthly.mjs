import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATASET_CONFIG,
  DEFAULT_FUEL_SERIES,
  fetchEmberMonthlyDataset,
  normalizeEmberMonthlyDataset,
  summarizeEmberMarkets,
} from "../connectors/ember-monthly.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const generationOutputPath = resolve(projectRoot, "data/ember-monthly-series.json");
const emissionsOutputPath = resolve(projectRoot, "data/ember-monthly-emissions-series.json");
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

const redactApiKey = (apiKey, url) => url.replace(apiKey, "{EMBER_API_KEY}");

const toMonthlyRows = (records, datasetKey) =>
  records
    .map((record) => {
      const config = DATASET_CONFIG[datasetKey];

      return {
        market: record.market,
        fuel_type: record.fuelType,
        bucket_start: `${record.observedAt.slice(0, 7)}-01`,
        observed_at: record.observedAt,
        [config.rowValueKey]: record.value,
        [config.rowShareKey]: record.sharePct,
        source: record.source,
        source_family: "Ember",
        source_label: "Ember API",
        connector: `ember-monthly-${datasetKey}`,
        is_proxy: false,
      };
    })
    .sort(
      (a, b) =>
        a.fuel_type.localeCompare(b.fuel_type) ||
        a.market.localeCompare(b.market) ||
        a.bucket_start.localeCompare(b.bucket_start)
    );

loadDotEnv();

const apiKey = process.env.EMBER_API_KEY;

if (!apiKey) {
  console.error("Missing EMBER_API_KEY. Add it to .env or export it in your shell, then rerun this script.");
  process.exit(1);
}

try {
  const fetchedAt = new Date().toISOString();
  const datasets = await Promise.all(
    ["generation", "emissions"].map(async (datasetKey) => {
      const { startDate, endDate, responses } = await fetchEmberMonthlyDataset(apiKey, datasetKey);
      const redactedResponses = responses.map((response) => ({
        ...response,
        url: redactApiKey(apiKey, response.url),
      }));
      const records = normalizeEmberMonthlyDataset(datasetKey, redactedResponses, fetchedAt).map((record) => ({
        ...record,
        sourceUrl: redactApiKey(apiKey, record.sourceUrl),
      }));

      return {
        datasetKey,
        startDate,
        endDate,
        records,
      };
    })
  );

  const generationDataset = datasets.find((dataset) => dataset.datasetKey === "generation");
  const emissionsDataset = datasets.find((dataset) => dataset.datasetKey === "emissions");

  if (!generationDataset || !emissionsDataset) {
    throw new Error("Missing one or more Ember monthly datasets.");
  }

  const markets = summarizeEmberMarkets(
    generationDataset.records.map((record) => ({
      entity: record.market === "European Union" ? "EU" : record.market,
      is_aggregate_entity: record.regionType === "bloc",
    }))
  );

  await mkdir(dirname(generationOutputPath), { recursive: true });

  await writeFile(
    generationOutputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        period: "monthly",
        startDate: generationDataset.startDate,
        endDate: generationDataset.endDate,
        marketCount: markets.length,
        fuelTypes: DEFAULT_FUEL_SERIES,
        markets,
        rows: toMonthlyRows(generationDataset.records, "generation"),
      },
      null,
      2
    )}\n`
  );

  await writeFile(
    emissionsOutputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        period: "monthly",
        startDate: emissionsDataset.startDate,
        endDate: emissionsDataset.endDate,
        marketCount: markets.length,
        fuelTypes: DEFAULT_FUEL_SERIES,
        markets,
        rows: toMonthlyRows(emissionsDataset.records, "emissions"),
      },
      null,
      2
    )}\n`
  );

  console.log(`Wrote ${generationOutputPath}`);
  console.log(`Wrote ${emissionsOutputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
