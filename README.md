# Power Pulse

This project is a power generation dashboard from Ember's Monthly Electricity Data API.

It displays every country and region returned by Ember's monthly electricity generation dataset for `2025-01` through the latest available month, across:

- Coal
- Gas
- Solar
- Wind
- Hydro
- Nuclear
- Total generation

Live dashboard:

- `https://cshearer1977.github.io/Coal-Power-Pulse/`

## Core files

- `index.html`: dashboard shell
- `app.css`: dashboard styling
- `app.js`: renders monthly Ember coverage, latest month, and the year-over-year chart
- `connectors/ember-monthly.mjs`: Ember monthly API query and normalization logic
- `scripts/fetch-ember-monthly.mjs`: refreshes `data/ember-monthly-series.json`
- `data/ember-monthly-series.json`: monthly Ember power generation history used by the dashboard
- `data/sources.json`: normalized schema for the Ember-only setup

## Refresh the data

The dashboard fetches Ember monthly data from `2025-01` through the latest available month for the supported fuel types, and checks for updates daily.

```bash
cd /Users/christines/Desktop/Workspace/Coal-Power-Pulse
node ./scripts/fetch-ember-monthly.mjs
```

## Preview locally

Because the page loads local JSON with `fetch`, serve the folder over HTTP:

```bash
cd /Users/christines/Desktop/Workspace/Coal-Power-Pulse
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000`

If the in-app browser caches an older version after edits, add a version query like:

- `http://localhost:8000/?v=19`
