const ONS_BRAZIL_GENERATION_BASE_URL =
  "https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/geracao_usina_2_ho";

const COAL_FUEL_LABELS = ["Carvão"];

const formatYearMonth = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}_${month}`;
};

const buildBrazilOnsUrl = (date = new Date()) =>
  `${ONS_BRAZIL_GENERATION_BASE_URL}/GERACAO_USINA-2_${formatYearMonth(date)}.csv`;

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

    if (char === ";" && !insideQuotes) {
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
    throw new Error("ONS Brazil CSV is empty or missing data rows.");
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

const getLatestTimestampInRows = (rows, { start, end } = {}) =>
  rows.reduce((latest, row) => {
    const timestamp = new Date(row.din_instante).getTime();

    if (!Number.isFinite(timestamp)) {
      return latest;
    }

    if (start && timestamp < new Date(start).getTime()) {
      return latest;
    }

    if (end && timestamp > new Date(end).getTime()) {
      return latest;
    }

    return Math.max(latest, timestamp);
  }, 0);

const normalizeBrazilCoalRows = (
  rows,
  fetchedAt = new Date().toISOString(),
  selection = {}
) => {
  const latestTimestamp = getLatestTimestampInRows(rows, selection);

  if (!latestTimestamp) {
    throw new Error("ONS Brazil generation rows did not include a usable din_instante timestamp.");
  }

  const latestIso = new Date(latestTimestamp).toISOString();
  const latestRows = rows.filter(
    (row) => new Date(row.din_instante).getTime() === latestTimestamp
  );

  const totalGenerationMw = latestRows.reduce(
    (sum, row) => sum + (toNumber(row.val_geracao) ?? 0),
    0
  );

  const coalRows = latestRows.filter((row) =>
    COAL_FUEL_LABELS.includes(row.nom_tipocombustivel)
  );

  const coalGenerationMw = coalRows.reduce(
    (sum, row) => sum + (toNumber(row.val_geracao) ?? 0),
    0
  );

  return {
    market: "Brazil",
    regionType: "country",
    observedAt: latestIso,
    fetchedAt,
    source: "ONS Dados Abertos",
    sourceUrl: `${ONS_BRAZIL_GENERATION_BASE_URL}/GERACAO_USINA-2_YYYY_MM.csv`,
    coalGenerationMw,
    coalGenerationMwh: coalGenerationMw,
    coalSharePct: totalGenerationMw ? (coalGenerationMw / totalGenerationMw) * 100 : null,
    totalGenerationMw,
    granularity: "hourly",
    latencyCategory: "near_live",
    fuelBucketSource: COAL_FUEL_LABELS.join(" + "),
    notes:
      "Uses ONS hourly plant-generation data and filters nom_tipocombustivel=Carvão. Coal share is computed against the total of all plant-generation rows at the selected timestamp."
  };
};

export const fetchBrazilOnsGeneration = async (date = new Date(), fetchImpl = fetch) => {
  const url = buildBrazilOnsUrl(date);
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`ONS Brazil generation request failed with ${response.status} ${response.statusText}`);
  }

  return {
    csv: await response.text(),
    url,
  };
};

export const normalizeBrazilCoalRecord = (csvContent, fetchedAt = new Date().toISOString()) => {
  const rows = parseCsv(csvContent);
  return normalizeBrazilCoalRows(rows, fetchedAt);
};

export const normalizeBrazilCoalRecordForRange = (
  csvContent,
  { start, end },
  fetchedAt = new Date().toISOString()
) => {
  const rows = parseCsv(csvContent);
  return normalizeBrazilCoalRows(rows, fetchedAt, { start, end });
};
