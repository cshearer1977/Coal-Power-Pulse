export const DEFAULT_FUEL_SERIES = [
  "Coal",
  "Gas",
  "Solar",
  "Solar + Wind",
  "Wind",
  "Hydro",
  "Nuclear",
  "Total generation",
];

const BASE_FUEL_SERIES = [
  "Coal",
  "Gas",
  "Solar",
  "Wind",
  "Hydro",
  "Nuclear",
  "Total generation",
];

export const DATASET_CONFIG = {
  generation: {
    datasetKey: "generation",
    label: "Power generation",
    route: "https://api.ember-energy.org/v1/electricity-generation/monthly",
    valueField: "generation_twh",
    shareField: "share_of_generation_pct",
    rowValueKey: "power_generation_twh",
    rowShareKey: "power_share_pct",
    valueUnitLabel: "TWh",
    notesTemplate: (series) => `Uses Ember's official monthly electricity generation API for the ${series} series.`,
    combinedNotes: "Derived by summing Ember's Solar and Wind monthly generation series.",
  },
  emissions: {
    datasetKey: "emissions",
    label: "Power sector emissions",
    route: "https://api.ember-energy.org/v1/power-sector-emissions/monthly",
    valueField: "emissions_mtco2",
    shareField: "share_of_emissions_pct",
    rowValueKey: "power_sector_emissions_mtco2",
    rowShareKey: "emissions_share_pct",
    valueUnitLabel: "MtCO2",
    notesTemplate: (series) => `Uses Ember's official monthly power sector emissions API for the ${series} series.`,
    combinedNotes: "Derived by summing Ember's Solar and Wind monthly power sector emissions series.",
  },
};

const monthEndIso = (value) => {
  const [year, month] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0, 23, 59, 59)).toISOString();
};

const roundValue = (value, digits = 4) => {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
};

const buildQuery = (route, apiKey, { startDate, endDate, series }) => {
  const url = new URL(route);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("series", series);
  return url;
};

export const fetchEmberMonthlyDataset = async (
  apiKey,
  datasetKey,
  fetchImpl = fetch,
  options = {}
) => {
  const config = DATASET_CONFIG[datasetKey];

  if (!config) {
    throw new Error(`Unknown Ember dataset: ${datasetKey}`);
  }

  const {
    startDate = "2020-01",
    endDate = new Date().toISOString().slice(0, 7),
    seriesList = BASE_FUEL_SERIES,
  } = options;

  const responses = await Promise.all(
    seriesList.map(async (series) => {
      const url = buildQuery(config.route, apiKey, { startDate, endDate, series });
      const response = await fetchImpl(url);

      if (!response.ok) {
        throw new Error(`Ember request failed for ${datasetKey}/${series} with ${response.status} ${response.statusText}`);
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
        expectedCadence: "Monthly series from January 2020 onward",
        statusLabel: row.is_aggregate_entity ? "Region" : "Country",
        statusClass: "live",
        isAggregate: Boolean(row.is_aggregate_entity),
      };

      markets.set(market, existing);
      return markets;
    }, new Map()).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

export const normalizeEmberMonthlyDataset = (
  datasetKey,
  responses,
  fetchedAt = new Date().toISOString()
) => {
  const config = DATASET_CONFIG[datasetKey];

  if (!config) {
    throw new Error(`Unknown Ember dataset: ${datasetKey}`);
  }

  const baseRecords = responses.flatMap(({ rows, url, series }) =>
    rows.map((row) => {
      const market = row.entity === "EU" ? "European Union" : row.entity;
      const value = Number(row[config.valueField]);
      const sharePct = Number(row[config.shareField]);

      return {
        market,
        fuelType: series,
        regionType: row.is_aggregate_entity ? "bloc" : "country",
        observedAt: monthEndIso(row.date),
        fetchedAt,
        source: "Ember API",
        sourceUrl: url,
        datasetKey,
        datasetLabel: config.label,
        value: Number.isFinite(value) ? value : null,
        sharePct: Number.isFinite(sharePct) ? sharePct : null,
        granularity: "monthly",
        latencyCategory: "delayed",
        seriesName: series,
        notes: config.notesTemplate(series),
      };
    })
  );

  const combinedRecords = Array.from(
    responses.reduce((combined, { rows, series }) => {
      if (series !== "Solar" && series !== "Wind") {
        return combined;
      }

      rows.forEach((row) => {
        const market = row.entity === "EU" ? "European Union" : row.entity;
        const key = `${market}::${row.date}`;
        const entry = combined.get(key) ?? {
          market,
          regionType: row.is_aggregate_entity ? "bloc" : "country",
          observedAt: monthEndIso(row.date),
          fetchedAt,
          source: "Ember API",
          sourceUrl: config.route,
          datasetKey,
          datasetLabel: config.label,
          value: 0,
          sharePct: 0,
          granularity: "monthly",
          latencyCategory: "delayed",
          seriesName: "Solar + Wind",
          notes: config.combinedNotes,
        };

        const value = Number(row[config.valueField]);
        const sharePct = Number(row[config.shareField]);
        entry.value += Number.isFinite(value) ? value : 0;
        entry.sharePct += Number.isFinite(sharePct) ? sharePct : 0;

        combined.set(key, entry);
      });

      return combined;
    }, new Map()).values()
  ).map((entry) => ({
    ...entry,
    fuelType: "Solar + Wind",
    value: roundValue(entry.value),
    sharePct: roundValue(entry.sharePct, 2),
  }));

  return [...baseRecords, ...combinedRecords];
};
