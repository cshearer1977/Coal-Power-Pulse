const EMBER_ROUTE = "https://api.ember-energy.org/v1/electricity-generation/monthly";

export const DEFAULT_FUEL_SERIES = [
  "Coal",
  "Gas",
  "Solar",
  "Wind",
  "Hydro",
  "Nuclear",
  "Total generation",
];

const monthEndIso = (value) => {
  const [year, month] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0, 23, 59, 59)).toISOString();
};

const buildQuery = (apiKey, { startDate, endDate, series }) => {
  const url = new URL(EMBER_ROUTE);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("series", series);
  return url;
};

export const fetchEmberMonthlySeries = async (apiKey, fetchImpl = fetch, options = {}) => {
  const {
    startDate = "2025-01",
    endDate = new Date().toISOString().slice(0, 7),
    seriesList = DEFAULT_FUEL_SERIES,
  } = options;

  const responses = await Promise.all(
    seriesList.map(async (series) => {
      const url = buildQuery(apiKey, { startDate, endDate, series });
      const response = await fetchImpl(url);

      if (!response.ok) {
        throw new Error(`Ember request failed for ${series} with ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      const rows = Array.isArray(payload?.data) ? payload.data : [];

      return {
        series,
        url: url.toString(),
        rows,
      };
    })
  );

  return {
    startDate,
    endDate,
    responses,
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
        statusLabel: row.is_aggregate_entity ? "Region" : "Country",
        statusClass: "live",
        isAggregate: Boolean(row.is_aggregate_entity),
      };

      markets.set(market, existing);
      return markets;
    }, new Map()).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

export const normalizeEmberMonthlySeries = (responses, fetchedAt = new Date().toISOString()) =>
  responses.flatMap(({ rows, url, series }) =>
    rows.map((row) => {
      const market = row.entity === "EU" ? "European Union" : row.entity;
      const generationTwh = Number(row.generation_twh);
      const sharePct = Number(row.share_of_generation_pct);

      return {
        market,
        fuelType: series,
        regionType: row.is_aggregate_entity ? "bloc" : "country",
        observedAt: monthEndIso(row.date),
        fetchedAt,
        source: "Ember API",
        sourceUrl: url,
        powerGenerationTwh: generationTwh,
        powerGenerationMwh: Number.isFinite(generationTwh) ? generationTwh * 1_000_000 : null,
        powerSharePct: Number.isFinite(sharePct) ? sharePct : null,
        granularity: "monthly",
        latencyCategory: "delayed",
        seriesName: series,
        notes: `Uses Ember's official monthly electricity generation API for the ${series} series.`,
      };
    })
  );
