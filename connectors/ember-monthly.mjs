const EMBER_ROUTE = "https://api.ember-energy.org/v1/electricity-generation/monthly";

const monthEndIso = (value) => {
  const [year, month] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0, 23, 59, 59)).toISOString();
};

const buildQuery = (apiKey, { startDate, endDate, series = "Coal" }) => {
  const url = new URL(EMBER_ROUTE);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("series", series);
  return url;
};

export const fetchEmberMonthlyCoalSeries = async (apiKey, fetchImpl = fetch, options = {}) => {
  const {
    startDate = "2025-01",
    endDate = new Date().toISOString().slice(0, 7),
  } = options;

  const url = buildQuery(apiKey, { startDate, endDate });
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Ember request failed with ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  return {
    startDate,
    endDate,
    url: url.toString(),
    rows,
  };
};

export const summarizeEmberMarkets = (rows) =>
  Array.from(
    rows.reduce((markets, row) => {
      const market = row.entity === "EU" ? "European Union" : row.entity;
      const existing = markets.get(market) ?? {
        name: market,
        primarySource: "Ember API",
        expectedCadence: "Monthly series from January 2025 onward",
        coalMapping: "Coal monthly generation series",
        statusLabel: row.is_aggregate_entity ? "Region" : "Country",
        statusClass: "live",
        isAggregate: Boolean(row.is_aggregate_entity),
      };

      markets.set(market, existing);
      return markets;
    }, new Map()).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

export const normalizeEmberMonthlyCoalSeries = (rows, fetchedAt = new Date().toISOString(), sourceUrl) =>
  rows.map((row) => {
    const market = row.entity === "EU" ? "European Union" : row.entity;
    const coalGenerationMwh = Number(row.generation_twh) * 1_000_000;
    const share = Number(row.share_of_generation_pct);
    const totalGenerationMwh = Number.isFinite(share) && share > 0 ? coalGenerationMwh / (share / 100) : null;

    return {
      market,
      regionType: row.is_aggregate_entity ? "bloc" : "country",
      observedAt: monthEndIso(row.date),
      fetchedAt,
      source: "Ember API",
      sourceUrl,
      coalGenerationMw: coalGenerationMwh,
      coalGenerationMwh,
      coalSharePct: share,
      totalGenerationMw: totalGenerationMwh,
      granularity: "monthly",
      latencyCategory: "delayed",
      fuelBucketSource: "Coal",
      notes: "Uses Ember's official monthly electricity generation API for the coal series.",
    };
  });
