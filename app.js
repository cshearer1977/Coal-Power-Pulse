const formatNumber = (value) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)
    : "—";

const formatPct = (value) => (Number.isFinite(value) ? `${value.toFixed(1)}%` : "—");

const formatTime = (value) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));

const formatAxisValue = (value, yMax, suffix = "") => {
  if (!Number.isFinite(value)) {
    return "—";
  }

  let maximumFractionDigits = 0;

  if (yMax < 1) {
    maximumFractionDigits = 2;
  } else if (yMax < 10) {
    maximumFractionDigits = 1;
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value) + suffix;
};

const formatBucketLabel = (value) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));

const compareMarkets = (a, b) => {
  if (a === "World" && b !== "World") {
    return -1;
  }

  if (b === "World" && a !== "World") {
    return 1;
  }

  return a.localeCompare(b);
};

const coverageGrid = document.querySelector("#coverage-grid");
const schemaPreview = document.querySelector("#schema-preview");
const snapshotBody = document.querySelector("#snapshot-body");
const snapshotGeneratedAt = document.querySelector("#snapshot-generated-at");
const coverageGeneratedAt = document.querySelector("#coverage-generated-at");
const seriesMetric = document.querySelector("#series-metric");
const seriesDisplay = document.querySelector("#series-display");
const seriesMarket = document.querySelector("#series-market");
const seriesFuel = document.querySelector("#series-fuel");
const seriesLegend = document.querySelector("#series-legend");
const seriesSummary = document.querySelector("#series-summary");
const seriesChart = document.querySelector("#series-chart");
const seriesTooltip = document.querySelector("#series-tooltip");
const START_YEAR_LABEL = "January 2020";

const SVG_NS = "http://www.w3.org/2000/svg";
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const METRIC_ORDER = ["generation", "emissions"];
const DISPLAY_ORDER = ["value", "share"];
const FUEL_ORDER = ["Coal", "Gas", "Solar", "Solar + Wind", "Wind", "Hydro", "Nuclear", "Total generation"];
const YEAR_PALETTE = [
  "#016b83",
  "#fe4f2d",
  "#4a57a8",
  "#7f142a",
  "#65bd8b",
  "#0f8ca0",
  "#c63f27",
  "#5f6cbc",
];

const METRIC_CONFIG = {
  generation: {
    label: "Power generation",
    shortLabel: "Generation",
    unit: "TWh",
    valueKey: "power_generation_twh",
    shareKey: "power_share_pct",
    sourcePath: "data/ember-monthly-series.json",
  },
  emissions: {
    label: "Power sector emissions",
    shortLabel: "Emissions",
    unit: "MtCO2",
    valueKey: "power_sector_emissions_mtco2",
    shareKey: "emissions_share_pct",
    sourcePath: "data/ember-monthly-emissions-series.json",
  },
};

const DISPLAY_CONFIG = {
  value: {
    label: "Value",
    axisLabel: (metric) => metric.unit,
    valueForRow: (row, metric) => row[metric.valueKey],
    formatForTooltip: (row, metric) => `${formatNumber(row[metric.valueKey])} ${metric.unit}`,
  },
  share: {
    label: "Percent share",
    axisLabel: () => "%",
    valueForRow: (row, metric) => row[metric.shareKey],
    formatForTooltip: (row, metric) => formatPct(row[metric.shareKey]),
  },
};

let hiddenYears = new Set();

const createSvgNode = (tag, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  return node;
};

const hideSeriesTooltip = () => {
  seriesTooltip.hidden = true;
};

const getYearColor = (year) => YEAR_PALETTE[(Math.abs(Number(year) - 2020)) % YEAR_PALETTE.length] ?? "#6c6c6c";
const getRowYear = (row) => new Date(`${row.bucket_start}T00:00:00Z`).getUTCFullYear();
const getRowMonthIndex = (row) => new Date(`${row.bucket_start}T00:00:00Z`).getUTCMonth();

const getDefaultHiddenYears = (rows) => {
  const years = Array.from(new Set(rows.map((row) => getRowYear(row)))).sort((a, b) => a - b);
  const visibleYears = new Set(years.slice(-2));
  return new Set(years.filter((year) => !visibleYears.has(year)));
};

const groupMonthlyRowsByYear = (rows) => {
  const grouped = new Map();

  rows.forEach((row) => {
    const year = getRowYear(row);

    if (!grouped.has(year)) {
      grouped.set(year, []);
    }

    grouped.get(year).push(row);
  });

  grouped.forEach((yearRows) => {
    yearRows.sort((a, b) => getRowMonthIndex(a) - getRowMonthIndex(b));
  });

  return grouped;
};

const latestRowsByMarket = (rows) => {
  const byMarket = new Map();

  rows.forEach((row) => {
    const existing = byMarket.get(row.market);

    if (!existing || new Date(row.observed_at).getTime() > new Date(existing.observed_at).getTime()) {
      byMarket.set(row.market, row);
    }
  });

  return Array.from(byMarket.values()).sort((a, b) => a.market.localeCompare(b.market));
};

const latestRowsByMarketForFuel = (rows, fuelType) =>
  latestRowsByMarket(rows.filter((row) => row.fuel_type === fuelType));

const renderSeriesLegend = (items, toggleYear) => {
  seriesLegend.replaceChildren();

  items.forEach((item) => {
    const legendItem = document.createElement("button");
    legendItem.type = "button";
    legendItem.className = `legend-item${item.hidden ? " legend-item-hidden" : ""}`;
    legendItem.setAttribute("aria-pressed", String(!item.hidden));
    legendItem.innerHTML = `
      <span class="legend-swatch" style="color: ${item.color}"></span>
      <span>${item.label}</span>
    `;
    legendItem.addEventListener("click", () => toggleYear(item.label));
    seriesLegend.append(legendItem);
  });

  seriesLegend.hidden = items.length === 0;
};

const showSeriesTooltip = ({ row, metric, x, y }) => {
  const chartBounds = seriesChart.getBoundingClientRect();

  seriesTooltip.innerHTML = `
    <strong>${row.market}</strong>
    <div>Fuel: ${row.fuel_type}</div>
    <div>Month of ${formatBucketLabel(row.bucket_start)}</div>
    <div>${metric.label}: ${formatNumber(row[metric.valueKey])} ${metric.unit}</div>
    <div>Share: ${formatPct(row[metric.shareKey])}</div>
    <div>Source: Ember API</div>
  `;

  seriesTooltip.style.left = `${(x / 960) * chartBounds.width + 12}px`;
  seriesTooltip.style.top = `${(y / 320) * chartBounds.height + 12}px`;
  seriesTooltip.hidden = false;
};

const renderLatestSnapshot = (payload, metricKey, fuelType) => {
  const metric = METRIC_CONFIG[metricKey];

  if (!payload?.generatedAt || !Array.isArray(payload.rows)) {
    snapshotGeneratedAt.textContent = "Monthly export unavailable";
    return;
  }

  snapshotGeneratedAt.textContent = `Ember monthly export generated ${formatTime(payload.generatedAt)}`;
  snapshotBody.replaceChildren();

  latestRowsByMarketForFuel(payload.rows, fuelType).forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.innerHTML = `
      <td>${row.market}</td>
      <td>${row.fuel_type}</td>
      <td>${row.bucket_start.slice(0, 7)}</td>
      <td>${formatNumber(row[metric.valueKey])}</td>
      <td>${formatPct(row[metric.shareKey])}</td>
      <td>${formatTime(row.observed_at)}</td>
      <td>Ember API</td>
    `;
    snapshotBody.append(tableRow);
  });
};

const renderCoverage = (payload) => {
  coverageGrid.replaceChildren();

  const latestBucketByMarket = Array.isArray(payload?.rows)
    ? payload.rows.reduce((map, row) => {
        const existing = map.get(row.market) ?? "";
        if (row.bucket_start > existing) {
          map.set(row.market, row.bucket_start);
        }
        return map;
      }, new Map())
    : new Map();

  if (coverageGeneratedAt) {
    const count = Number(payload?.marketCount) || (Array.isArray(payload?.markets) ? payload.markets.length : 0);
    coverageGeneratedAt.textContent = `Ember coverage: ${count} countries and regions`;
  }

  (payload?.markets ?? []).forEach((market) => {
    const latestBucket = latestBucketByMarket.get(market.name) ?? "";
    const latestLabel = latestBucket ? formatBucketLabel(latestBucket) : "latest available month";
    const article = document.createElement("article");
    article.className = "coverage-card";
    article.innerHTML = `
      <div class="status-pill status-${market.statusClass}">${market.statusLabel}</div>
      <h3>${market.name}</h3>
      <div class="meta-line"><strong>Source:</strong> ${market.primarySource}</div>
      <div class="meta-line"><strong>Coverage:</strong> Monthly series from ${START_YEAR_LABEL} to ${latestLabel}</div>
    `;
    coverageGrid.append(article);
  });
};

const renderSeriesChart = (rows, metricKey, displayKey) => {
  const metric = METRIC_CONFIG[metricKey];
  const display = DISPLAY_CONFIG[displayKey];

  seriesChart.replaceChildren();
  hideSeriesTooltip();

  if (!rows.length) {
    renderSeriesLegend([], () => {});
    seriesSummary.hidden = true;
    return;
  }

  const width = 960;
  const height = 320;
  const margin = { top: 28, right: 20, bottom: 48, left: 96 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const buckets = MONTH_LABELS.map((_, index) => index);
  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket, index]));
  const byYear = groupMonthlyRowsByYear(rows);
  const visibleYears = Array.from(byYear.keys()).filter((year) => !hiddenYears.has(year));
  const visibleRows = rows.filter((row) => visibleYears.includes(getRowYear(row)));
  const values = visibleRows.map((row) => display.valueForRow(row, metric)).filter((value) => Number.isFinite(value));

  const toggleYear = (label) => {
    const year = Number(label);
    if (hiddenYears.has(year)) {
      hiddenYears.delete(year);
    } else {
      hiddenYears.add(year);
    }

    renderSeriesChart(rows, metricKey, displayKey);
  };

  if (!values.length) {
    const legendItems = Array.from(byYear.keys())
      .sort((a, b) => a - b)
      .map((year) => ({ label: String(year), color: getYearColor(year), hidden: hiddenYears.has(year) }));

    renderSeriesLegend(legendItems, toggleYear);
    seriesSummary.hidden = true;
    return;
  }

  const maxValue = Math.max(...values, 0);
  const yMax = maxValue > 0 ? maxValue * 1.1 : 1;
  const xStep = innerWidth / (buckets.length - 1);
  const yTicks = 4;

  const xForBucket = (bucket) => margin.left + xStep * bucketIndex.get(bucket);
  const xForRow = (row) => xForBucket(getRowMonthIndex(row));
  const yForValue = (value) => margin.top + innerHeight - (value / yMax) * innerHeight;

  const plot = createSvgNode("g");
  seriesChart.append(plot);

  const axisLabel = createSvgNode("text", {
    x: margin.left - 12,
    y: 12,
    "text-anchor": "end",
    fill: "#655d56",
    "font-size": 12,
    "font-family": "IBM Plex Mono, monospace",
  });
  axisLabel.textContent = display.axisLabel(metric);
  plot.append(axisLabel);

  for (let tick = 0; tick <= yTicks; tick += 1) {
    const value = (yMax / yTicks) * tick;
    const y = yForValue(value);
    plot.append(
      createSvgNode("line", {
        x1: margin.left,
        y1: y,
        x2: width - margin.right,
        y2: y,
        stroke: "rgba(33, 28, 24, 0.10)",
        "stroke-width": 1,
      })
    );

    const label = createSvgNode("text", {
      x: margin.left - 12,
      y: y + 4,
      "text-anchor": "end",
      fill: "#655d56",
      "font-size": 12,
      "font-family": "IBM Plex Mono, monospace",
    });
    label.textContent = formatAxisValue(value, yMax, displayKey === "share" ? "%" : "");
    plot.append(label);
  }

  plot.append(
    createSvgNode("line", {
      x1: margin.left,
      y1: height - margin.bottom,
      x2: width - margin.right,
      y2: height - margin.bottom,
      stroke: "rgba(33, 28, 24, 0.24)",
      "stroke-width": 1.5,
    })
  );

  buckets.forEach((bucket) => {
    const x = xForBucket(bucket);

    plot.append(
      createSvgNode("line", {
        x1: x,
        y1: height - margin.bottom,
        x2: x,
        y2: height - margin.bottom + 6,
        stroke: "rgba(33, 28, 24, 0.24)",
        "stroke-width": 1.5,
      })
    );

    const label = createSvgNode("text", {
      x,
      y: height - margin.bottom + 24,
      "text-anchor": "middle",
      fill: "#655d56",
      "font-size": 12,
      "font-family": "IBM Plex Mono, monospace",
    });
    label.textContent = MONTH_LABELS[bucket];
    plot.append(label);
  });

  const legendItems = [];

  Array.from(byYear.keys())
    .sort((a, b) => a - b)
    .forEach((year) => {
      const yearRows = byYear.get(year);
      const color = getYearColor(year);

      legendItems.push({ label: String(year), color, hidden: hiddenYears.has(year) });

      if (hiddenYears.has(year)) {
        return;
      }

      const linePoints = yearRows
        .filter((row) => Number.isFinite(display.valueForRow(row, metric)))
        .map((row) => `${xForRow(row)},${yForValue(display.valueForRow(row, metric))}`)
        .join(" ");

      if (!linePoints) {
        return;
      }

      plot.append(
        createSvgNode("polyline", {
          points: linePoints,
          fill: "none",
          stroke: color,
          "stroke-width": 4,
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
        })
      );

      yearRows.forEach((row) => {
        const plottedValue = display.valueForRow(row, metric);

        if (!Number.isFinite(plottedValue)) {
          return;
        }

        const x = xForRow(row);
        const y = yForValue(plottedValue);
        const circle = createSvgNode("circle", {
          cx: x,
          cy: y,
          r: 4.5,
          fill: color,
          stroke: "#fff",
          "stroke-width": 2,
          tabindex: 0,
        });

        const title = createSvgNode("title");
        title.textContent = `${row.market}: ${display.formatForTooltip(row, metric)} in ${formatBucketLabel(row.bucket_start)}`;
        circle.append(title);
        circle.addEventListener("mouseenter", () => showSeriesTooltip({ row, metric, x, y }));
        circle.addEventListener("focus", () => showSeriesTooltip({ row, metric, x, y }));
        circle.addEventListener("mouseleave", hideSeriesTooltip);
        circle.addEventListener("blur", hideSeriesTooltip);
        plot.append(circle);
      });
    });

  renderSeriesLegend(legendItems, toggleYear);
  seriesSummary.hidden = true;
};

const renderSeriesControls = (datasets) => {
  const generationPayload = datasets.generation;

  seriesMetric.replaceChildren();
  seriesDisplay.replaceChildren();
  seriesMarket.replaceChildren();
  seriesFuel.replaceChildren();

  const markets = Array.from(new Set((generationPayload.rows ?? []).map((row) => row.market))).sort(compareMarkets);
  const fuels = (generationPayload.fuelTypes ?? []).slice().sort((a, b) => {
    const ai = FUEL_ORDER.indexOf(a);
    const bi = FUEL_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
  });

  if (!markets.length) {
    seriesSummary.hidden = true;
    return;
  }

  METRIC_ORDER.forEach((metricKey) => {
    const option = document.createElement("option");
    option.value = metricKey;
    option.textContent = METRIC_CONFIG[metricKey].shortLabel;
    seriesMetric.append(option);
  });

  DISPLAY_ORDER.forEach((displayKey) => {
    const option = document.createElement("option");
    option.value = displayKey;
    option.textContent = DISPLAY_CONFIG[displayKey].label;
    seriesDisplay.append(option);
  });

  markets.forEach((market) => {
    const option = document.createElement("option");
    option.value = market;
    option.textContent = market;
    seriesMarket.append(option);
  });

  fuels.forEach((fuel) => {
    const option = document.createElement("option");
    option.value = fuel;
    option.textContent = fuel;
    seriesFuel.append(option);
  });

  seriesMetric.value = "generation";
  seriesDisplay.value = "value";
  seriesMarket.value = markets.includes("World")
    ? "World"
    : markets.includes("United States")
    ? "United States"
    : markets[0];
  seriesFuel.value = fuels.includes("Coal") ? "Coal" : fuels[0];

  const refreshSeries = () => {
    const activePayload = datasets[seriesMetric.value];
    const filteredRows = (activePayload.rows ?? []).filter(
      (row) => row.market === seriesMarket.value && row.fuel_type === seriesFuel.value
    );

    hiddenYears = getDefaultHiddenYears(filteredRows);
    renderSeriesChart(filteredRows, seriesMetric.value, seriesDisplay.value);
    renderLatestSnapshot(activePayload, seriesMetric.value, seriesFuel.value);
    renderCoverage(activePayload);
  };

  refreshSeries();
  seriesMetric.addEventListener("change", refreshSeries);
  seriesDisplay.addEventListener("change", refreshSeries);
  seriesMarket.addEventListener("change", refreshSeries);
  seriesFuel.addEventListener("change", refreshSeries);
};

const load = async () => {
  const [sourcesResponse, generationResponse, emissionsResponse] = await Promise.all([
    fetch("./data/sources.json", { cache: "no-store" }),
    fetch("./data/ember-monthly-series.json", { cache: "no-store" }),
    fetch("./data/ember-monthly-emissions-series.json", { cache: "no-store" }),
  ]);

  const sources = await sourcesResponse.json();
  const generationMonthly = await generationResponse.json();
  const emissionsMonthly = await emissionsResponse.json();

  schemaPreview.textContent = JSON.stringify(sources.normalizedRecordSchema, null, 2);
  renderCoverage(generationMonthly);
  renderLatestSnapshot(generationMonthly, "generation", "Coal");
  renderSeriesControls({
    generation: generationMonthly,
    emissions: emissionsMonthly,
  });
};

load().catch((error) => {
  console.error(error);
  schemaPreview.textContent = "Failed to load local Ember data files.";
});
