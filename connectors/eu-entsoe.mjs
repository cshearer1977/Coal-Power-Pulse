const ENTSOE_API_ROUTE = "https://web-api.tp.entsoe.eu/api";
const COAL_PSR_TYPES = ["B02", "B05"];

const addMinutes = (timestamp, minutes) =>
  new Date(new Date(timestamp).getTime() + minutes * 60 * 1000);

const toEntsoeDate = (date) => {
  const utc = new Date(date);
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  const hours = String(utc.getUTCHours()).padStart(2, "0");
  const minutes = String(utc.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}`;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripXml = (value) => value.replace(/<!\[CDATA\[|\]\]>/g, "").trim();

const matchSingle = (text, pattern) => {
  const match = text.match(pattern);
  return match ? stripXml(match[1]) : null;
};

const matchAll = (text, pattern) => Array.from(text.matchAll(pattern), (match) => match[1]);

const resolutionToMinutes = (resolution) => {
  if (resolution === "PT60M") {
    return 60;
  }

  if (resolution === "PT30M") {
    return 30;
  }

  if (resolution === "PT15M") {
    return 15;
  }

  throw new Error(`Unsupported ENTSO-E resolution: ${resolution}`);
};

const parsePointQuantity = (pointXml) => {
  const quantity = matchSingle(pointXml, /<quantity>([^<]+)<\/quantity>/);
  if (quantity !== null) {
    return Number(quantity);
  }

  const amount = matchSingle(pointXml, /<quantity\.quantity>([^<]+)<\/quantity\.quantity>/);
  if (amount !== null) {
    return Number(amount);
  }

  return null;
};

const parsePeriodPoints = (periodXml, seriesType) => {
  const start = matchSingle(periodXml, /<start>([^<]+)<\/start>/);
  const resolution = matchSingle(periodXml, /<resolution>([^<]+)<\/resolution>/);
  const intervalMinutes = resolutionToMinutes(resolution);

  const pointMatches = periodXml.match(/<Point>[\s\S]*?<\/Point>/g) ?? [];

  return pointMatches
    .map((pointXml) => {
      const position = Number(matchSingle(pointXml, /<position>([^<]+)<\/position>/));
      const quantity = parsePointQuantity(pointXml);

      if (!position || quantity === null) {
        return null;
      }

      const observedAt = addMinutes(start, (position - 1) * intervalMinutes).toISOString();

      return {
        observedAt,
        valueMw: quantity,
        psrType: seriesType
      };
    })
    .filter(Boolean);
};

const parseTimeSeries = (seriesXml) => {
  const psrType =
    matchSingle(seriesXml, /<MktPSRType>[\s\S]*?<psrType>([^<]+)<\/psrType>[\s\S]*?<\/MktPSRType>/) ??
    matchSingle(seriesXml, /<MktPSRType\.psrType>([^<]+)<\/MktPSRType\.psrType>/) ??
    matchSingle(seriesXml, /<mktPSRType\.psrType>([^<]+)<\/mktPSRType\.psrType>/);

  const periods = seriesXml.match(/<Period>[\s\S]*?<\/Period>/g) ?? [];

  return periods.flatMap((periodXml) => parsePeriodPoints(periodXml, psrType));
};

export const buildEntsoeQuery = ({ token, inDomain, start, end, psrType }) => {
  const url = new URL(ENTSOE_API_ROUTE);
  url.searchParams.set("securityToken", token);
  url.searchParams.set("documentType", "A75");
  url.searchParams.set("processType", "A16");
  url.searchParams.set("in_Domain", inDomain);
  url.searchParams.set("periodStart", toEntsoeDate(start));
  url.searchParams.set("periodEnd", toEntsoeDate(end));

  if (psrType) {
    url.searchParams.set("psrType", psrType);
  }

  return url;
};

export const parseEntsoeGenerationXml = (xml) => {
  const timeSeriesBlocks = xml.match(/<TimeSeries>[\s\S]*?<\/TimeSeries>/g) ?? [];
  return timeSeriesBlocks.flatMap(parseTimeSeries);
};

export const aggregateEuCoalSnapshot = (countrySnapshots, fetchedAt = new Date().toISOString()) => {
  const complete = countrySnapshots.filter((snapshot) => snapshot.latestCoalMw !== null);

  if (!complete.length) {
    throw new Error("No EU country snapshots were available to aggregate.");
  }

  const observedAt = complete
    .map((snapshot) => snapshot.observedAt)
    .sort()
    .at(-1);

  const coalGenerationMw = complete.reduce((sum, snapshot) => sum + snapshot.latestCoalMw, 0);
  const totalGenerationMw = complete.reduce((sum, snapshot) => sum + snapshot.latestTotalMw, 0);

  return {
    market: "European Union",
    regionType: "bloc",
    observedAt,
    fetchedAt,
    source: "ENTSO-E",
    sourceUrl: "https://web-api.tp.entsoe.eu/api?securityToken={ENTSOE_API_TOKEN}&documentType=A75&processType=A16",
    coalGenerationMw,
    coalGenerationMwh: coalGenerationMw,
    coalSharePct: totalGenerationMw ? (coalGenerationMw / totalGenerationMw) * 100 : null,
    totalGenerationMw,
    granularity: "hourly",
    latencyCategory: "near_live",
    fuelBucketSource: "B02 + B05",
    notes: `Aggregates configured ENTSO-E bidding zones using Actual Generation per Type (A75, A16). Included areas: ${complete
      .map((snapshot) => snapshot.country)
      .join(", ")}.`
  };
};

export const fetchEntsoeAreaSnapshot = async (
  { token, inDomain, country, lookbackHours = 6 },
  fetchImpl = fetch
) => {
  const end = new Date();
  const start = addMinutes(end, -lookbackHours * 60);
  const url = buildEntsoeQuery({ token, inDomain, start, end });
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`ENTSO-E request failed for ${country}: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const points = parseEntsoeGenerationXml(xml);
  const grouped = new Map();

  for (const point of points) {
    const key = point.observedAt;
    const existing = grouped.get(key) ?? { observedAt: key, latestCoalMw: 0, latestTotalMw: 0 };
    existing.latestTotalMw += point.valueMw;

    if (COAL_PSR_TYPES.includes(point.psrType)) {
      existing.latestCoalMw += point.valueMw;
    }

    if (point.psrType) {
      existing[point.psrType] = (existing[point.psrType] ?? 0) + point.valueMw;
    }

    grouped.set(key, existing);
  }

  const latest = Array.from(grouped.values()).sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);

  return {
    country,
    inDomain,
    observedAt: latest?.observedAt ?? null,
    latestCoalMw: latest?.latestCoalMw ?? null,
    latestTotalMw: latest?.latestTotalMw ?? null,
    requestUrls: [url.toString().replace(token, "{ENTSOE_API_TOKEN}")]
  };
};

export const validateEuAreas = (areas) => {
  const configured = areas.filter((area) => area.inDomain);

  if (!configured.length) {
    throw new Error("No ENTSO-E inDomain area codes are configured yet. Fill data/eu-areas.json first.");
  }

  return configured;
};
