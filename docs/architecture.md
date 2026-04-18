# Coal Power Pulse Architecture

## What we are building

One dashboard with one normalized table of latest coal generation observations.
Each market gets its own connector, but the frontend should not need market-specific logic.

## Canonical units

- Prefer `coalGenerationMwh` for stored snapshots and time-series work.
- Allow `coalGenerationMw` only as a source compatibility field when a feed uses power terminology for what is effectively the latest interval value.
- Store `observedAt` separately from `fetchedAt` so the dashboard can show real source latency.

## Historical storage

The project now persists normalized snapshots into `data/coal-history.sqlite`.

Tables and outputs:

- `snapshots`: one normalized row per market observation
- `latest_snapshots`: convenience view for most recent row per market
- `data/daily-series.json`: latest observation per market per day since `2026-01-01`
- `data/weekly-series.json`: latest observation per market per week since `2026-01-01`

This gives us a local time-series base without requiring a server database.

In addition to the government-source history exports, the dashboard now has a separate Ember monthly comparison layer in `data/ember-monthly-series.json`. That file is intentionally kept separate so monthly Ember points can be overlaid in the chart without being mistaken for the primary official connector for a market.

Current backfill coverage:

- `United States`: weekly backfill implemented from EIA hourly fuel-mix history
- `Brazil`: weekly backfill implemented from ONS monthly hourly plant-generation files
- `India`: weekly backfill implemented from NPP's dated JSON feed, still explicitly marked as a thermal-generation proxy
- `South Korea`: monthly backfill implemented from KPX EPSIS by-source data, with coal defined as bituminous plus anthracite
- `China`: manual monthly import path implemented around official NBS thermal-power data, explicitly marked as a thermal proxy
- `Turkiye`: weekly backfill implemented from the authenticated EPİAŞ realtime generation endpoint
- `Ember comparison`: monthly coal generation overlay implemented from Ember's official API for 2025 and overlapping 2026 months
- `European Union`: blocked on ENTSO-E token and area mappings
- `South Africa`: blocked on manual Eskom export flow

## Connector contract

Every connector should emit:

```json
{
  "market": "United States",
  "regionType": "country",
  "observedAt": "2026-04-16T14:00:00Z",
  "fetchedAt": "2026-04-16T14:05:12Z",
  "source": "EIA",
  "sourceUrl": "https://...",
  "coalGenerationMw": 13320,
  "coalGenerationMwh": null,
  "coalSharePct": 15.2,
  "totalGenerationMw": 87600,
  "granularity": "hourly",
  "latencyCategory": "near_live",
  "fuelBucketSource": "coal",
  "notes": "Use direct coal series from the source."
}
```

## Market-by-market wrinkles

- `United States`: likely the easiest first connector because coal is usually explicit in EIA data.
  The first implementation uses the hourly EIA `electricity/rto/fuel-type-data` route for respondent `US48`, then isolates `fueltype=COL` and computes coal share from the full latest fuel mix snapshot.
- `European Union`: treat this as an aggregate layer over multiple ENTSO-E country feeds. Coal should combine hard coal and lignite when the source splits them.
  The scaffold uses ENTSO-E Actual Generation per Type with `documentType=A75` and `processType=A16`, aggregating `PsrType B02` (Fossil Brown coal/Lignite) and `B05` (Fossil Hard coal). ENTSO-E documents this feed as published no later than one hour after the operational period.
- `India`: the main design question is whether we can get coal directly or only broader thermal buckets.
  The current implementation uses NPP's `demandmet2chartdata` JSON feed and takes `THERMAL GENERATION` as a coal-dominant proxy. This is not strictly coal-only, so the UI and notes should keep that caveat visible until we find a cleaner real-time coal split.
- `South Africa`: a national system snapshot may be sufficient for MVP even if it is not plant-level.
  Eskom's official data portal lists a `Thermal Generation` supply-side dataset plus separate gas, OCGT, hydro, nuclear, and renewables. The public site appears to use static chart images and an email-based data request flow, so the current connector path is a manual CSV import that normalizes the latest thermal row as a coal-dominant proxy.
- `Turkiye`: likely a fuel-splitting exercise between lignite and imported coal.
  EPİAŞ documents an authenticated realtime generation service. The connector rolls up `lignite`, `blackCoal`, `importCoal`, and `asphaltiteCoal` into the shared coal bucket, matching your coal+lignite rule.
- `Brazil`: may require extracting coal from a broader thermal category depending on the operational feed.
  ONS's hourly plant-generation dataset turns out to be better than the subsystem thermal totals because it exposes `nom_tipocombustivel`. The Brazil connector filters `nom_tipocombustivel = Carvão` directly, which avoids a thermal proxy.
- `South Korea` and `Japan`: Ember points to monthly sources, so we need to verify whether operator or ministry endpoints expose something faster.
- `South Korea`: KPX EPSIS exposes monthly by-source generation output with explicit bituminous and anthracite coal columns. This is a workable official monthly connector even if it is not live.
- `China`: likely not truly real-time. The current implementation uses official NBS monthly thermal-power rows as a delayed thermal proxy through a manual CSV import, because the National Data query endpoint is blocked by NBS web application controls from this runtime.
- `Ember comparison layer`: Ember is not the primary live connector for any market here. It is a deliberately separate monthly benchmark layer so we can compare Ember's harmonized monthly coal series against the higher-frequency government-source ingestion where the periods overlap.

## Delivery strategy

1. Build the `United States` connector.
2. Build the `European Union` connector.
3. Add a tiny local cache or generated JSON snapshot for the dashboard to read.
4. Expand one country at a time while keeping the schema stable.
