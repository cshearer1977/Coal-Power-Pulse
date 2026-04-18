const EPM_TABLE_URL = "https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=table_1_01";

const monthIndexByName = new Map([
  ["January", 0],
  ["February", 1],
  ["March", 2],
  ["April", 3],
  ["May", 4],
  ["June", 5],
  ["July", 6],
  ["August", 7],
  ["September", 8],
  ["October", 9],
  ["November", 10],
  ["December", 11],
]);

const stripHtml = (value) =>
  value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .trim();

const toNumber = (value) => {
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const monthEndIso = (year, monthIndex) =>
  new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59)).toISOString();

export const fetchUsEiaEpmTable = async (fetchImpl = fetch) => {
  const response = await fetchImpl(EPM_TABLE_URL);

  if (!response.ok) {
    throw new Error(`EIA Electric Power Monthly request failed with ${response.status} ${response.statusText}`);
  }

  return response.text();
};

export const normalizeUsEiaEpmMonthlyRecords = (
  html,
  fetchedAt = new Date().toISOString()
) => {
  const rows = Array.from(html.matchAll(/<tr>([\s\S]*?)<\/tr>/g), (match) => match[1]);
  const records = [];
  let activeYear = null;

  for (const rowHtml of rows) {
    const cells = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (match) =>
      stripHtml(match[1])
    ).filter(Boolean);

    if (!cells.length) {
      continue;
    }

    const yearMatch = cells[0].match(/^Year\s+(\d{4})$/);

    if (yearMatch) {
      activeYear = Number(yearMatch[1]);
      continue;
    }

    if (!activeYear || cells.length < 13) {
      continue;
    }

    const monthName = cells[0].trim();
    const monthIndex = monthIndexByName.get(monthName);

    if (monthIndex === undefined) {
      continue;
    }

    const coalGenerationThousandMwh = toNumber(cells[1]);
    const totalGenerationThousandMwh = toNumber(cells[12]);

    if (coalGenerationThousandMwh === null || totalGenerationThousandMwh === null) {
      continue;
    }

    const coalGenerationMwh = coalGenerationThousandMwh * 1_000;
    const totalGenerationMwh = totalGenerationThousandMwh * 1_000;

    records.push({
      market: "United States",
      regionType: "country",
      observedAt: monthEndIso(activeYear, monthIndex),
      fetchedAt,
      source: "EIA Electric Power Monthly",
      sourceUrl: EPM_TABLE_URL,
      coalGenerationMw: coalGenerationMwh,
      coalGenerationMwh,
      coalSharePct:
        coalGenerationMwh && totalGenerationMwh ? (coalGenerationMwh / totalGenerationMwh) * 100 : null,
      totalGenerationMw: totalGenerationMwh,
      granularity: "monthly",
      latencyCategory: "delayed",
      fuelBucketSource: "Coal",
      notes:
        "Uses EIA Electric Power Monthly Table 1.1, Net Generation by Energy Source: Total (All Sectors). Coal values are national monthly totals in thousand MWh."
    });
  }

  return records.filter((record) => record.observedAt >= "2025-01-01T00:00:00Z");
};
