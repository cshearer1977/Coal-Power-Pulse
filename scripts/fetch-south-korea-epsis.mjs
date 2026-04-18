import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchSouthKoreaEpsisGeneration,
  normalizeSouthKoreaLatestCoalRecord,
} from "../connectors/south-korea-epsis.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputPath = resolve(projectRoot, "data/south-korea-latest.json");

try {
  const fetchedAt = new Date().toISOString();
  const { rows, requestBody } = await fetchSouthKoreaEpsisGeneration();
  const record = normalizeSouthKoreaLatestCoalRecord(rows, fetchedAt);
  await persistSnapshot({ connector: "south-korea-epsis", record });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        connector: "south-korea-epsis",
        requestBody,
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
