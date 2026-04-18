const DEFAULT_SOURCE_URL = "https://www.eskom.co.za/dataportal/data-request-form/";

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

const toNumber = (value) => {
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const pickField = (row, candidates) => {
  for (const candidate of candidates) {
    if (candidate in row && row[candidate] !== "") {
      return row[candidate];
    }
  }
  return null;
};

const parseTimestamp = (row) => {
  const raw = pickField(row, [
    "datetime",
    "DateTime",
    "timestamp",
    "Timestamp",
    "date_time",
    "Date",
    "date",
  ]);

  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const normalizeSouthAfricaThermalCsv = (
  csvContent,
  fetchedAt = new Date().toISOString()
) => {
  const rows = parseCsv(csvContent);
  const enriched = rows
    .map((row) => ({
      row,
      observedAt: parseTimestamp(row),
      thermalGenerationMw: toNumber(
        pickField(row, [
          "Thermal Generation",
          "thermal_generation",
          "ThermalGeneration",
          "value",
          "Value",
        ])
      ),
      totalGenerationMw: toNumber(
        pickField(row, [
          "Dispatchable Generation",
          "dispatchable_generation",
          "Total Generation",
          "total_generation",
        ])
      ),
    }))
    .filter((entry) => entry.observedAt && entry.thermalGenerationMw !== null)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));

  const latest = enriched.at(-1);

  if (!latest) {
    throw new Error(
      "Could not find a valid South Africa thermal generation row. Expected a timestamp and Thermal Generation column."
    );
  }

  return {
    market: "South Africa",
    regionType: "country",
    observedAt: latest.observedAt,
    fetchedAt,
    source: "Eskom Data Portal",
    sourceUrl: DEFAULT_SOURCE_URL,
    coalGenerationMw: latest.thermalGenerationMw,
    coalGenerationMwh: latest.thermalGenerationMw,
    coalSharePct:
      latest.totalGenerationMw && latest.thermalGenerationMw
        ? (latest.thermalGenerationMw / latest.totalGenerationMw) * 100
        : null,
    totalGenerationMw: latest.totalGenerationMw,
    granularity: "manual_csv_import",
    latencyCategory: "near_live",
    fuelBucketSource: "Thermal Generation",
    notes:
      "Uses Eskom Data Portal Thermal Generation as a coal-dominant proxy from a manually requested CSV export. Eskom lists Thermal Generation, Gas Generation, OCGT, Nuclear, Hydro, and renewables separately in its official data request form."
  };
};
