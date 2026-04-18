import {
  fetchSouthKoreaEpsisGeneration,
  normalizeSouthKoreaCoalSeries,
} from "../connectors/south-korea-epsis.mjs";
import { persistSnapshot } from "../lib/sqlite-store.mjs";

try {
  const { rows } = await fetchSouthKoreaEpsisGeneration({
    beginDate: "202601",
    endDate: new Date().toISOString().slice(0, 7).replace("-", ""),
  });

  const records = normalizeSouthKoreaCoalSeries(rows, new Date().toISOString()).filter(
    (record) => record.observedAt >= "2026-01-01T00:00:00Z"
  );

  let persisted = 0;
  for (const record of records) {
    await persistSnapshot({ connector: "south-korea-epsis", record });
    persisted += 1;
    console.log(`South Korea monthly backfill: stored ${record.observedAt}`);
  }

  console.log(`South Korea monthly backfill complete. Stored ${persisted} months.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
