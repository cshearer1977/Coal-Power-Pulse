import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeChinaMonthlyCsv } from "../connectors/china-nbs.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const inputPath = resolve(projectRoot, "data/raw/china-nbs-monthly.csv");
const outputPath = resolve(projectRoot, "data/china-latest.json");

try {
  const fetchedAt = new Date().toISOString();
  const csv = await readFile(inputPath, "utf8");
  const { records, latest } = normalizeChinaMonthlyCsv(csv, fetchedAt);

  for (const record of records) {
    await persistSnapshot({ connector: "china-nbs", record, isProxy: true });
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        connector: "china-nbs",
        inputFile: inputPath,
        importedRecords: records.length,
        record: latest,
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
