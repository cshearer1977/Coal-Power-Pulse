const EPIAS_LOGIN_URL = "https://giris.epias.com.tr/cas/v1/tickets";
const EPIAS_REALTIME_GENERATION_URL =
  "https://seffaflik.epias.com.tr/electricity-service/v1/generation/data/realtime-generation";

const COAL_FIELDS = ["lignite", "blackCoal", "importCoal", "asphaltiteCoal"];

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sumFields = (record, fields) =>
  fields.reduce((sum, field) => sum + (toNumber(record[field]) ?? 0), 0);

export const fetchEpiasTgt = async ({ username, password }, fetchImpl = fetch) => {
  const body = new URLSearchParams();
  body.set("username", username);
  body.set("password", password);

  const response = await fetchImpl(EPIAS_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/plain",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`EPİAŞ login failed with ${response.status} ${response.statusText}`);
  }

  const tgt = (await response.text()).trim();

  if (!tgt.startsWith("TGT-")) {
    throw new Error("EPİAŞ login response did not return a valid TGT token.");
  }

  return tgt;
};

export const buildEpiasRealtimeBody = (date = new Date()) => {
  const next = new Date(date);
  next.setHours(next.getHours() + 1);

  return {
    startDate: date.toISOString(),
    endDate: next.toISOString(),
  };
};

export const fetchEpiasRealtimeGeneration = async (
  { username, password, date = new Date() },
  fetchImpl = fetch
) => {
  const tgt = await fetchEpiasTgt({ username, password }, fetchImpl);
  const body = buildEpiasRealtimeBody(date);

  const response = await fetchImpl(EPIAS_REALTIME_GENERATION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      TGT: tgt,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `EPİAŞ realtime generation request failed with ${response.status} ${response.statusText}`
    );
  }

  const payload = await response.json();
  const items = payload?.items;

  if (!Array.isArray(items)) {
    throw new Error("Unexpected EPİAŞ payload shape: expected items array.");
  }

  return {
    payload,
    requestBody: body,
  };
};

export const normalizeTurkiyeCoalRecord = (
  payload,
  fetchedAt = new Date().toISOString()
) => {
  const items = payload?.items;

  if (!Array.isArray(items) || !items.length) {
    throw new Error("EPİAŞ returned no realtime generation items.");
  }

  const latest = [...items]
    .filter((item) => item.date)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .at(-1);

  if (!latest) {
    throw new Error("EPİAŞ items did not include a valid date field.");
  }

  const coalGenerationMw = sumFields(latest, COAL_FIELDS);
  const totalGenerationMw = toNumber(latest.total);

  return {
    market: "Turkiye",
    regionType: "country",
    observedAt: latest.date,
    fetchedAt,
    source: "EPİAŞ Transparency Platform",
    sourceUrl: EPIAS_REALTIME_GENERATION_URL,
    coalGenerationMw,
    coalGenerationMwh: coalGenerationMw,
    coalSharePct: totalGenerationMw ? (coalGenerationMw / totalGenerationMw) * 100 : null,
    totalGenerationMw,
    granularity: "hourly",
    latencyCategory: "live",
    fuelBucketSource: COAL_FIELDS.join(" + "),
    notes:
      "Coal rollup includes lignite, black coal, imported coal, and asphaltite coal from EPİAŞ realtime generation data."
  };
};
