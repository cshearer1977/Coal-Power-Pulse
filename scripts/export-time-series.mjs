import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureHistoryDb, readSeries } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const dailyOutputPath = resolve(projectRoot, "data/daily-series.json");
const weeklyOutputPath = resolve(projectRoot, "data/weekly-series.json");
const monthlyOutputPath = resolve(projectRoot, "data/monthly-series.json");

try {
  await ensureHistoryDb();

  const [daily, weekly, monthly] = await Promise.all([
    readSeries("daily"),
    readSeries("weekly"),
    readSeries("monthly")
  ]);
  const generatedAt = new Date().toISOString();

  await mkdir(dirname(dailyOutputPath), { recursive: true });
  await writeFile(
    dailyOutputPath,
    `${JSON.stringify({ generatedAt, period: "daily", rows: daily }, null, 2)}\n`
  );
  await writeFile(
    weeklyOutputPath,
    `${JSON.stringify({ generatedAt, period: "weekly", rows: weekly }, null, 2)}\n`
  );
  await writeFile(
    monthlyOutputPath,
    `${JSON.stringify({ generatedAt, period: "monthly", rows: monthly }, null, 2)}\n`
  );

  console.log(`Wrote ${dailyOutputPath}`);
  console.log(`Wrote ${weeklyOutputPath}`);
  console.log(`Wrote ${monthlyOutputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
