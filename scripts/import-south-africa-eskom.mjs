import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeSouthAfricaThermalCsv } from "../connectors/south-africa-eskom.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const inputPath = resolve(projectRoot, "data/raw/south-africa-eskom-thermal.csv");
const outputPath = resolve(projectRoot, "data/south-africa-latest.json");

try {
  const fetchedAt = new Date().toISOString();
  const csv = await readFile(inputPath, "utf8");
  const record = normalizeSouthAfricaThermalCsv(csv, fetchedAt);
  await persistSnapshot({ connector: "south-africa-eskom", record, isProxy: true });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        connector: "south-africa-eskom",
        inputFile: inputPath,
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
