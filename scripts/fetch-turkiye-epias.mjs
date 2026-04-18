import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchEpiasRealtimeGeneration,
  normalizeTurkiyeCoalRecord,
} from "../connectors/turkiye-epias.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const outputPath = resolve(projectRoot, "data/turkiye-latest.json");
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

const username = process.env.EPIAS_USERNAME;
const password = process.env.EPIAS_PASSWORD;

if (!username || !password) {
  console.error("Missing EPIAS_USERNAME or EPIAS_PASSWORD. Add them to .env, then rerun this script.");
  process.exit(1);
}

try {
  const fetchedAt = new Date().toISOString();
  const { payload, requestBody } = await fetchEpiasRealtimeGeneration({ username, password });
  const record = normalizeTurkiyeCoalRecord(payload, fetchedAt);
  await persistSnapshot({ connector: "turkiye-epias", record });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: fetchedAt,
        connector: "turkiye-epias",
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
