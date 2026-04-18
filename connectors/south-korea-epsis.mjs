import vm from "node:vm";

const SOUTH_KOREA_EPSIS_ROUTE = "https://epsis.kpx.or.kr/epsisnew/selectEkmaGcpBft.ajax";

const toNumber = (value) => {
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const pad = (value) => String(value).padStart(2, "0");

const toYearMonth = (date = new Date()) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}`;

const monthHours = (year, month) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate() * 24;

const periodToObservedAt = (period) => {
  const [yearText, monthText] = period.split("/");
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59)).toISOString();
};

const periodToEstimatedMwh = (period, averageMw) => {
  if (averageMw === null || averageMw === undefined) {
    return null;
  }

  const [yearText, monthText] = period.split("/");
  const hours = monthHours(Number(yearText), Number(monthText));
  return averageMw * hours;
};

const parseEpsisJavascriptRows = (content) => {
  const context = {
    gridData: [],
    textFormmat: (value) => value,
    $: () => ({
      val: () => "0",
    }),
  };

  vm.createContext(context);
  vm.runInContext(content, context);

  if (!Array.isArray(context.gridData)) {
    throw new Error("EPSIS response did not produce a gridData array.");
  }

  return context.gridData;
};

export const fetchSouthKoreaEpsisGeneration = async (
  {
    beginDate = toYearMonth(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1))),
    endDate = toYearMonth(new Date()),
    region = "1",
  } = {},
  fetchImpl = fetch
) => {
  const body = new URLSearchParams();
  body.set("beginDate", beginDate);
  body.set("endDate", endDate);
  body.set("selYear", "N");
  body.set("selRegion", region);
  body.set("locale", "eng");

  const response = await fetchImpl(SOUTH_KOREA_EPSIS_ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`EPSIS request failed with ${response.status} ${response.statusText}`);
  }

  const script = await response.text();
  const rows = parseEpsisJavascriptRows(script);

  return {
    rows,
    requestBody: Object.fromEntries(body.entries()),
  };
};

export const normalizeSouthKoreaCoalSeries = (
  rows,
  fetchedAt = new Date().toISOString()
) => {
  const normalized = rows
    .filter((row) => row?.Region === "Total" && typeof row?.Period === "string" && row.Period.includes("/"))
    .map((row) => {
      const bituminousCoalMw = toNumber(row.c2);
      const anthraciteCoalMw = toNumber(row.c3);
      const totalGenerationMw = toNumber(row.c8);
      const coalGenerationMw =
        (bituminousCoalMw ?? 0) + (anthraciteCoalMw ?? 0);

      return {
        market: "South Korea",
        regionType: "country",
        observedAt: periodToObservedAt(row.Period),
        fetchedAt,
        source: "KPX EPSIS",
        sourceUrl: SOUTH_KOREA_EPSIS_ROUTE,
        coalGenerationMw,
        coalGenerationMwh: periodToEstimatedMwh(row.Period, coalGenerationMw),
        coalSharePct: totalGenerationMw ? (coalGenerationMw / totalGenerationMw) * 100 : null,
        totalGenerationMw,
        granularity: "monthly",
        latencyCategory: "delayed",
        fuelBucketSource: "Bituminous coal + Anthracite coal",
        notes:
          "Uses KPX EPSIS monthly Generation Output by Source for All Region. Coal combines Bituminous coal and Anthracite coal. GWh is estimated from the reported monthly average MW multiplied by hours in the month."
      };
    })
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());

  if (!normalized.length) {
    throw new Error("EPSIS returned no usable South Korea total rows.");
  }

  return normalized;
};

export const normalizeSouthKoreaLatestCoalRecord = (
  rows,
  fetchedAt = new Date().toISOString()
) => normalizeSouthKoreaCoalSeries(rows, fetchedAt).at(-1);
