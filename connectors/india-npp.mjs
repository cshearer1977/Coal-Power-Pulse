const INDIA_NPP_ROUTE = "https://www.npp.gov.in/dashBoard/demandmet2chartdata";

const normalizeLabel = (value) => value.trim().toUpperCase();

const toDateString = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const coerceNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildIndiaNppQuery = (date = new Date()) => {
  const url = new URL(INDIA_NPP_ROUTE);
  url.searchParams.set("date", toDateString(date));
  return url;
};

export const normalizeIndiaThermalRecord = (rows, fetchedAt = new Date().toISOString()) => {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("NPP returned no India generation rows.");
  }

  const latestTimestamp = rows.reduce((latest, row) => Math.max(latest, Number(row.updated_on) || 0), 0);

  if (!latestTimestamp) {
    throw new Error("NPP rows did not include a usable updated_on timestamp.");
  }

  const latestRows = rows.filter((row) => Number(row.updated_on) === latestTimestamp);
  const metrics = new Map(
    latestRows.map((row) => [normalizeLabel(row.name_of_data), coerceNumber(row.value_of_data)])
  );

  const thermalGenerationMw = metrics.get("THERMAL GENERATION");

  if (thermalGenerationMw === null || thermalGenerationMw === undefined) {
    throw new Error("NPP latest India snapshot did not include THERMAL GENERATION.");
  }

  const totalGenerationMw = Array.from(metrics.values()).reduce(
    (sum, value) => sum + (value ?? 0),
    0
  );

  return {
    market: "India",
    regionType: "country",
    observedAt: new Date(latestTimestamp).toISOString(),
    fetchedAt,
    source: "National Power Portal (NPP)",
    sourceUrl: `${INDIA_NPP_ROUTE}?date=YYYY-MM-DD`,
    coalGenerationMw: thermalGenerationMw,
    coalGenerationMwh: thermalGenerationMw,
    coalSharePct: totalGenerationMw ? (thermalGenerationMw / totalGenerationMw) * 100 : null,
    totalGenerationMw,
    granularity: "near_real_time",
    latencyCategory: "live",
    fuelBucketSource: "THERMAL GENERATION",
    notes:
      "NPP real-time feed reports THERMAL GENERATION rather than coal-only generation. This connector uses THERMAL GENERATION as a coal-dominant proxy until a cleaner coal/lignite split is confirmed."
  };
};

export const fetchIndiaNppGeneration = async (date = new Date(), fetchImpl = fetch) => {
  // NPP currently presents a TLS chain that Node may reject in some environments.
  // We scope this workaround to the India connector only.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const url = buildIndiaNppQuery(date);
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`NPP request failed with ${response.status} ${response.statusText}`);
  }

  const rows = await response.json();

  if (!Array.isArray(rows)) {
    throw new Error("Unexpected NPP payload shape: expected a JSON array.");
  }

  return {
    rows,
    url: url.toString()
  };
};
