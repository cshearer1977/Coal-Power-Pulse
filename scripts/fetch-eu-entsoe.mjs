import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateEuCoalSnapshot,
  fetchEntsoeAreaSnapshot,
  validateEuAreas,
} from "../connectors/eu-entsoe.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputPath = resolve(projectRoot, "data/eu-latest.json");
const envPath = resolve(projectRoot, ".env");
const areasPath = resolve(projectRoot, "data/eu-areas.json");

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

const token = process.env.ENTSOE_API_TOKEN;

if (!token) {
  console.error("Missing ENTSOE_API_TOKEN. Add it to .env after ENTSO-E approves your access.");
  process.exit(1);
}

try {
  const areas = JSON.parse(readFileSync(areasPath, "utf8"));
  const configuredAreas = validateEuAreas(areas);
  const fetchedAt = new Date().toISOString();

  const countrySnapshots = await Promise.all(
    configuredAreas.map((area) =>
      fetchEntsoeAreaSnapshot({
        token,
        country: area.country,
        inDomain: area.inDomain,
      })
    )
  );

  const record = aggregateEuCoalSnapshot(countrySnapshots, fetchedAt);
  await persistSnapshot({ connector: "eu-entsoe", record });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        connector: "eu-entsoe",
        configuredAreas: configuredAreas.map(({ country, inDomain }) => ({ country, inDomain })),
        record,
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
