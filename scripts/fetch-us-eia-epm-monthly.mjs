import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchUsEiaEpmTable, normalizeUsEiaEpmMonthlyRecords } from "../connectors/us-eia-epm-monthly.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputPath = resolve(projectRoot, "data/us-eia-epm-monthly.json");

try {
  const fetchedAt = new Date().toISOString();
  const html = await fetchUsEiaEpmTable();
  const records = normalizeUsEiaEpmMonthlyRecords(html, fetchedAt);

  for (const record of records) {
    await persistSnapshot({ connector: "us-eia-epm-monthly", record });
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        connector: "us-eia-epm-monthly",
        sourceUrl: "https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=table_1_01",
        importedRecords: records.length,
        latestRecord: records.at(-1) ?? null,
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
