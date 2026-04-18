const DEFAULT_SOURCE_URL = "https://data.stats.gov.cn/english/easyquery.htm?cn=A01";

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === "," && !insideQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const parseCsv = (content) => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV file is empty or missing data rows.");
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
};

const pickField = (row, candidates) => {
  for (const candidate of candidates) {
    if (candidate in row && row[candidate] !== "") {
      return row[candidate];
    }
  }

  return null;
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseMonthStart = (value) => {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().replace(/[/.]/g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return new Date(Date.UTC(year, monthIndex, 1));
};

const toMonthEndIso = (value) => {
  const monthStart = parseMonthStart(value);

  if (!monthStart) {
    return null;
  }

  return new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59)
  ).toISOString();
};

const hoursInObservedMonth = (observedAt) => {
  const date = new Date(observedAt);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate() * 24;
};

const toMwh = (value, unit) => {
  if (value === null) {
    return null;
  }

  switch (unit) {
    case "mwh":
      return value;
    case "gwh":
      return value * 1_000;
    case "twh":
    case "billion_kwh":
      return value * 1_000_000;
    default:
      return value;
  }
};

const detectUnit = (row, fieldName, fallbackCandidates) => {
  const explicitUnit = pickField(row, fallbackCandidates);

  if (explicitUnit) {
    const normalized = explicitUnit.toLowerCase();
    if (normalized.includes("billion") && normalized.includes("kwh")) {
      return "billion_kwh";
    }
    if (normalized === "twh") {
      return "twh";
    }
    if (normalized === "gwh") {
      return "gwh";
    }
    if (normalized === "mwh") {
      return "mwh";
    }
  }

  if (fieldName.includes("bkwh") || fieldName.includes("billion")) {
    return "billion_kwh";
  }

  if (fieldName.includes("twh")) {
    return "twh";
  }

  if (fieldName.includes("gwh")) {
    return "gwh";
  }

  if (fieldName.includes("mwh")) {
    return "mwh";
  }

  return "billion_kwh";
};

const normalizeChinaMonthlyRows = (csvContent, fetchedAt = new Date().toISOString()) => {
  const rows = parseCsv(csvContent);

  const normalized = rows
    .map((row) => {
      const observedAt = toMonthEndIso(
        pickField(row, ["month", "Month", "period", "Period", "date", "Date"])
      );

      const thermalFieldName =
        ["thermal_generation_bkwh", "thermal_generation_twh", "thermal_generation_gwh", "thermal_generation_mwh", "thermal_generation", "Thermal Generation", "thermal_power_generation", "fire_power_generation"]
          .find((candidate) => candidate in row && row[candidate] !== "") ?? "";
      const totalFieldName =
        ["total_generation_bkwh", "total_generation_twh", "total_generation_gwh", "total_generation_mwh", "total_generation", "Total Generation", "electricity_generation", "power_generation"]
          .find((candidate) => candidate in row && row[candidate] !== "") ?? "";

      const thermalRaw = toNumber(thermalFieldName ? row[thermalFieldName] : null);
      const totalRaw = toNumber(totalFieldName ? row[totalFieldName] : null);
      const thermalUnit = detectUnit(row, thermalFieldName, ["thermal_unit", "Thermal Unit", "unit", "Unit"]);
      const totalUnit = detectUnit(row, totalFieldName, ["total_unit", "Total Unit", "unit", "Unit"]);
      const coalGenerationMwh = toMwh(thermalRaw, thermalUnit);
      const totalGenerationMwh = toMwh(totalRaw, totalUnit);
      const coalGenerationMw =
        observedAt && coalGenerationMwh !== null ? coalGenerationMwh / hoursInObservedMonth(observedAt) : null;

      return {
        market: "China",
        regionType: "country",
        observedAt,
        fetchedAt,
        source: "National Bureau of Statistics of China",
        sourceUrl: DEFAULT_SOURCE_URL,
        coalGenerationMw,
        coalGenerationMwh,
        coalSharePct:
          totalGenerationMwh && coalGenerationMwh
            ? (coalGenerationMwh / totalGenerationMwh) * 100
            : null,
        totalGenerationMw:
          observedAt && totalGenerationMwh !== null ? totalGenerationMwh / hoursInObservedMonth(observedAt) : null,
        granularity: "monthly",
        latencyCategory: "delayed",
        fuelBucketSource: "Thermal power generation",
        notes:
          "Uses official NBS monthly thermal power generation as a coal-dominant proxy. Ember treats China as a modeled/disaggregated case; this connector preserves NBS thermal as the closest official monthly signal until a cleaner coal-plus-lignite split is available."
      };
    })
    .filter((record) => record.observedAt && record.coalGenerationMwh !== null)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));

  if (!normalized.length) {
    throw new Error(
      "Could not find valid China monthly rows. Expected month plus thermal generation columns in the CSV."
    );
  }

  return normalized;
};

export const normalizeChinaMonthlyCsv = (csvContent, fetchedAt = new Date().toISOString()) => {
  const records = normalizeChinaMonthlyRows(csvContent, fetchedAt);
  return {
    records,
    latest: records.at(-1),
  };
};
