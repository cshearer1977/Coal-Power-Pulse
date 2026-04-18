import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
export const databasePath = resolve(projectRoot, "data", "coal-history.sqlite");

const sqlValue = (value) => {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return `'${String(value).replace(/'/g, "''")}'`;
};

const runSql = (sql, json = false) => {
  const args = [];

  if (json) {
    args.push("-json");
  }

  args.push(databasePath, sql);

  const result = spawnSync("sqlite3", args, {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "sqlite3 command failed.");
  }

  return result.stdout;
};

export const ensureHistoryDb = async () => {
  await mkdir(dirname(databasePath), { recursive: true });

  runSql(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL,
      region_type TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      coal_generation_mwh REAL,
      coal_share_pct REAL,
      total_generation_mwh REAL,
      granularity TEXT,
      latency_category TEXT,
      fuel_bucket_source TEXT,
      notes TEXT,
      connector TEXT NOT NULL,
      is_proxy INTEGER NOT NULL DEFAULT 0,
      raw_record_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (market, observed_at, source, connector)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_market_observed
      ON snapshots (market, observed_at DESC);

    CREATE VIEW IF NOT EXISTS latest_snapshots AS
      SELECT s.*
      FROM snapshots s
      JOIN (
        SELECT market, MAX(observed_at) AS observed_at
        FROM snapshots
        GROUP BY market
      ) latest
      ON latest.market = s.market
      AND latest.observed_at = s.observed_at;
  `);
};

export const persistSnapshot = async ({ connector, record, isProxy = false }) => {
  await ensureHistoryDb();

  const coalGenerationMwh = record.coalGenerationMwh ?? record.coalGenerationMw ?? null;
  const totalGenerationMwh = record.totalGenerationMw ?? null;

  runSql(`
    INSERT OR IGNORE INTO snapshots (
      market,
      region_type,
      observed_at,
      fetched_at,
      source,
      source_url,
      coal_generation_mwh,
      coal_share_pct,
      total_generation_mwh,
      granularity,
      latency_category,
      fuel_bucket_source,
      notes,
      connector,
      is_proxy,
      raw_record_json
    ) VALUES (
      ${sqlValue(record.market)},
      ${sqlValue(record.regionType ?? "country")},
      ${sqlValue(record.observedAt)},
      ${sqlValue(record.fetchedAt)},
      ${sqlValue(record.source)},
      ${sqlValue(record.sourceUrl)},
      ${sqlValue(coalGenerationMwh)},
      ${sqlValue(record.coalSharePct)},
      ${sqlValue(totalGenerationMwh)},
      ${sqlValue(record.granularity)},
      ${sqlValue(record.latencyCategory)},
      ${sqlValue(record.fuelBucketSource)},
      ${sqlValue(record.notes)},
      ${sqlValue(connector)},
      ${sqlValue(isProxy)},
      ${sqlValue(JSON.stringify(record))}
    );
  `);
};

export const readSeries = async (period = "weekly") => {
  await ensureHistoryDb();

  const bucketExpression =
    period === "daily"
      ? "date(observed_at)"
      : period === "monthly"
      ? "strftime('%Y-%m-01', observed_at)"
      : "date(observed_at, '-' || strftime('%w', observed_at) || ' days')";
  const connectorFilter =
    period === "monthly"
      ? `
        AND connector IN (
          'us-eia-epm-monthly',
          'china-nbs',
          'japan-enecho',
          'eu-entsoe'
        )
      `
      : period === "weekly"
      ? `
        AND connector NOT IN (
          'ember-monthly',
          'us-eia',
          'us-eia-monthly',
          'us-eia-epm-monthly',
          'south-korea-epsis',
          'china-nbs',
          'japan-enecho',
          'eu-entsoe'
        )
      `
      : `
        AND connector NOT IN (
          'ember-monthly',
          'us-eia-monthly',
          'us-eia-epm-monthly',
          'south-korea-epsis',
          'china-nbs',
          'japan-enecho',
          'eu-entsoe'
        )
      `;

  const output = runSql(
    `
      WITH ranked AS (
        SELECT
          market,
          ${bucketExpression} AS bucket_start,
          observed_at,
          coal_generation_mwh,
          coal_share_pct,
          total_generation_mwh,
          source,
          connector,
          is_proxy,
          ROW_NUMBER() OVER (
            PARTITION BY market, ${bucketExpression}
            ORDER BY observed_at DESC, fetched_at DESC
          ) AS row_num
        FROM snapshots
        WHERE observed_at >= '2026-01-01T00:00:00Z'
        ${connectorFilter}
      )
      SELECT
        market,
        bucket_start,
        observed_at,
        coal_generation_mwh,
        coal_share_pct,
        total_generation_mwh,
        source,
        connector,
        is_proxy
      FROM ranked
      WHERE row_num = 1
      ORDER BY market, bucket_start;
    `,
    true
  );

  return JSON.parse(output || "[]");
};
