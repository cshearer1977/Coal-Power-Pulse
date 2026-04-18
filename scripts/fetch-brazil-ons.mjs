import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchBrazilOnsGeneration, normalizeBrazilCoalRecord } from "../connectors/brazil-ons.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputPath = resolve(projectRoot, "data/brazil-latest.json");

try {
  const fetchedAt = new Date().toISOString();
  const { csv, url } = await fetchBrazilOnsGeneration();
  const record = normalizeBrazilCoalRecord(csv, fetchedAt);
  await persistSnapshot({ connector: "brazil-ons", record });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        connector: "brazil-ons",
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
