# Power Pulse Architecture

## What this project is

`Power Pulse` is a static dashboard backed by Ember's Monthly Electricity Data API.

It shows:

- every country and region returned by the Ember monthly electricity endpoint for the supported fuel types
- a monthly year-over-year time series from `2025-01` onward
- the latest available Ember month for the selected fuel
- market coverage metadata derived from the Ember response itself

## Supported fuel types

The current dashboard fetches and renders these Ember monthly series:

- `Coal`
- `Gas`
- `Solar`
- `Solar + Wind`
- `Wind`
- `Hydro`
- `Nuclear`
- `Total generation`

## Canonical record shape

The generated dataset in `data/ember-monthly-series.json` uses one normalized row shape:

```json
{
  "market": "World",
  "fuel_type": "Coal",
  "bucket_start": "2026-03-01",
  "observed_at": "2026-03-31T23:59:59.000Z",
  "power_generation_twh": 812.4,
  "power_generation_mwh": 812400000,
  "power_share_pct": 33.1,
  "source": "Ember API",
  "source_family": "Ember",
  "source_label": "Ember API",
  "connector": "ember-monthly",
  "is_proxy": false
}
```

## Data flow

1. `scripts/fetch-ember-monthly.mjs` loads `EMBER_API_KEY` from `.env`.
2. `connectors/ember-monthly.mjs` fetches the supported Ember monthly series in parallel.
3. The script normalizes the response into one JSON artifact:
   - `data/ember-monthly-series.json`
4. The static frontend reads that JSON directly and renders the dashboard.

## Refresh model

- The local workflow can refresh data by running:
  - `node ./scripts/fetch-ember-monthly.mjs`
- The GitHub repository also has a scheduled workflow that refreshes the Ember dataset daily and republishes the site through GitHub Pages.

## Frontend assumptions

- `World` should appear first in the country/region selector when it is available.
- `Coal` is the default fuel view.
- The chart uses a fixed `Jan` through `Dec` x-axis so users can compare years directly.
- The y-axis is plotted in `TWh`.
- The latest-month table is fuel-filtered, so it always reflects the currently selected fuel series.
