const EIA_ROUTE = "https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/";
const US_RESPONDENT = "US48";
const DEFAULT_LENGTH = 100;

const coerceNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toEiaDate = (value) => {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}`;
};

const buildQuery = (apiKey, options = {}) => {
  const { start, end, length = DEFAULT_LENGTH } = options;
  const url = new URL(EIA_ROUTE);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("frequency", "hourly");
  url.searchParams.set("data[0]", "value");
  url.searchParams.set("facets[respondent][]", US_RESPONDENT);
  url.searchParams.set("sort[0][column]", "period");
  url.searchParams.set("sort[0][direction]", "desc");
  url.searchParams.set("offset", "0");
  url.searchParams.set("length", String(length));

  if (start) {
    url.searchParams.set("start", toEiaDate(start));
  }

  if (end) {
    url.searchParams.set("end", toEiaDate(end));
  }

  return url;
};

const findLatestPeriod = (rows) => rows.find((row) => row.period)?.period ?? null;
const findEarliestPeriod = (rows) => rows.at(-1)?.period ?? null;

const sumValues = (rows) =>
  rows.reduce((total, row) => total + (coerceNumber(row.value) ?? 0), 0);

const periodToIso = (value) => `${value}:00Z`;

const monthEndIso = (value) => {
  const date = new Date(`${value}-01T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
};

export const normalizeUsMonthlyCoalRecord = (
  rows,
  fetchedAt = new Date().toISOString(),
  options = {}
) => {
  const latestPeriod = findLatestPeriod(rows);
  const earliestPeriod = findEarliestPeriod(rows);

  if (!latestPeriod || !earliestPeriod) {
    throw new Error("EIA returned no rows for the US48 respondent.");
  }

  const coalRows = rows.filter((row) => row.fueltype === "COL");

  if (!coalRows.length) {
    throw new Error("EIA monthly aggregation found no coal rows in the requested range.");
  }

  const coalGenerationMwh = sumValues(coalRows);
  const totalGenerationMwh = sumValues(rows);
  const coalSharePct =
    coalGenerationMwh && totalGenerationMwh
      ? (coalGenerationMwh / totalGenerationMwh) * 100
      : null;

  const monthKey = latestPeriod.slice(0, 7);
  const observedAt = options.isPartialMonth ? periodToIso(latestPeriod) : monthEndIso(monthKey);
  const notePrefix = options.isPartialMonth
    ? "Uses EIA hourly fuel-mix data summed month-to-date."
    : "Uses EIA hourly fuel-mix data summed across the full calendar month.";

  return {
    market: "United States",
    regionType: "country",
    observedAt,
    fetchedAt,
    source: "EIA",
    sourceUrl: buildQuery("YOUR_API_KEY", {
      start: new Date(`${earliestPeriod}:00Z`),
      end: new Date(`${latestPeriod}:00Z`),
      length: options.length ?? 20000,
    })
      .toString()
      .replace("YOUR_API_KEY", "{EIA_API_KEY}"),
    coalGenerationMw: coalGenerationMwh,
    coalGenerationMwh,
    coalSharePct,
    totalGenerationMw: totalGenerationMwh,
    granularity: "monthly",
    latencyCategory: options.isPartialMonth ? "near_live" : "delayed",
    fuelBucketSource: "COL",
    notes: `${notePrefix} This produces a true monthly government total for the US from the official hourly EIA respondent US48 series.`
  };
};

export const normalizeUsWeeklyCoalRecord = (
  rows,
  fetchedAt = new Date().toISOString(),
  options = {}
) => {
  const latestPeriod = findLatestPeriod(rows);
  const earliestPeriod = findEarliestPeriod(rows);

  if (!latestPeriod || !earliestPeriod) {
    throw new Error("EIA returned no rows for the requested weekly window.");
  }

  const coalRows = rows.filter((row) => row.fueltype === "COL");

  if (!coalRows.length) {
    throw new Error("EIA weekly aggregation found no coal rows in the requested range.");
  }

  const coalGenerationMwh = sumValues(coalRows);
  const totalGenerationMwh = sumValues(rows);
  const coalSharePct =
    coalGenerationMwh && totalGenerationMwh
      ? (coalGenerationMwh / totalGenerationMwh) * 100
      : null;

  return {
    market: "United States",
    regionType: "country",
    observedAt: periodToIso(latestPeriod),
    fetchedAt,
    source: "EIA",
    sourceUrl: buildQuery("YOUR_API_KEY", {
      start: new Date(`${earliestPeriod}:00Z`),
      end: new Date(`${latestPeriod}:00Z`),
      length: options.length ?? 5000,
    })
      .toString()
      .replace("YOUR_API_KEY", "{EIA_API_KEY}"),
    coalGenerationMw: coalGenerationMwh,
    coalGenerationMwh,
    coalSharePct,
    totalGenerationMw: totalGenerationMwh,
    granularity: "weekly",
    latencyCategory: "near_live",
    fuelBucketSource: "COL",
    notes:
      "Uses EIA /electricity/rto/fuel-type-data for respondent US48, summed across all hourly observations in the weekly window."
  };
};

export const normalizeUsCoalRecord = (rows, fetchedAt = new Date().toISOString()) => {
  const latestPeriod = findLatestPeriod(rows);

  if (!latestPeriod) {
    throw new Error("EIA returned no rows for the US48 respondent.");
  }

  const latestRows = rows.filter((row) => row.period === latestPeriod);
  const coalRow = latestRows.find((row) => row.fueltype === "COL");

  if (!coalRow) {
    throw new Error(`EIA returned ${latestRows.length} rows for ${latestPeriod}, but no coal row was present.`);
  }

  const totalGenerationMwh = sumValues(latestRows);
  const coalGenerationMwh = coerceNumber(coalRow.value);
  const coalSharePct =
    coalGenerationMwh && totalGenerationMwh
      ? (coalGenerationMwh / totalGenerationMwh) * 100
      : null;

  return {
    market: "United States",
    regionType: "country",
    observedAt: `${latestPeriod}:00Z`,
    fetchedAt,
    source: "EIA",
    sourceUrl: buildQuery("YOUR_API_KEY").toString().replace("YOUR_API_KEY", "{EIA_API_KEY}"),
    coalGenerationMw: coalGenerationMwh,
    coalGenerationMwh,
    coalSharePct,
    totalGenerationMw: totalGenerationMwh,
    granularity: "hourly",
    latencyCategory: "near_live",
    fuelBucketSource: "COL",
    notes:
      "Uses EIA /electricity/rto/fuel-type-data for respondent US48. Values are reported as megawatthours for the hourly interval and are shown here as the dashboard's live coal signal."
  };
};

export const fetchUsFuelMix = async (apiKey, fetchImpl = fetch, options = {}) => {
  const url = buildQuery(apiKey, options);
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`EIA request failed with ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const rows = payload?.response?.data;

  if (!Array.isArray(rows)) {
    throw new Error("Unexpected EIA payload shape: response.data is missing.");
  }

  return {
    rows,
    url: url.toString()
  };
};
