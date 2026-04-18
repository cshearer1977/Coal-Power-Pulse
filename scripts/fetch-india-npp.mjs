import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchIndiaNppGeneration, normalizeIndiaThermalRecord } from "../connectors/india-npp.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputPath = resolve(projectRoot, "data/india-latest.json");

try {
  const fetchedAt = new Date().toISOString();
  const { rows, url } = await fetchIndiaNppGeneration();
  const record = normalizeIndiaThermalRecord(rows, fetchedAt);
  await persistSnapshot({ connector: "india-npp", record, isProxy: true });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        connector: "india-npp",
        requestUrl: url,
        record
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
