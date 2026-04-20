const formatNumber = (value) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)
    : "—";

const formatPct = (value) => (Number.isFinite(value) ? `${value.toFixed(1)}%` : "—");
const formatDeltaPct = (value) =>
  Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(1)}%` : "—";

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

  return (
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }).format(value) + suffix
  );
};

const getNiceStep = (rawStep) => {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1;
  }

  if (rawStep < 2.5) {
    return rawStep;
  }

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceNormalizedStep = [1, 1.5, 2, 2.5, 5, 10].find((candidate) => normalized <= candidate) ?? 10;
  return niceNormalizedStep * magnitude;
};

const getYAxisDomain = (values, displayKey) => {
  const finiteValues = values.filter((value) => Number.isFinite(value));

  if (!finiteValues.length) {
    return { yMin: 0, yMax: 1 };
  }

  if (displayKey !== "change") {
    const maxValue = Math.max(...finiteValues, 0);
    return { yMin: 0, yMax: maxValue > 0 ? getNiceStep(maxValue / 4) * 4 : 1 };
  }

  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  const maxAbs = Math.max(Math.abs(minValue), Math.abs(maxValue), 1);
  const step = getNiceStep(maxAbs / 2);
  return { yMin: -step * 2, yMax: step * 2 };
};

const formatBucketLabel = (value) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));

const formatAnnualPeriodLabel = (value) => `Jan-Dec ${value.slice(0, 4)}`;
const formatAnnualCoverageLabel = (months, year) => {
  if (!Array.isArray(months) || !months.length) {
    return formatAnnualPeriodLabel(`${year}-01-01`);
  }

  const monthNames = months.map((month) =>
    new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
      new Date(`${year}-${month}-01T00:00:00Z`)
    )
  );
  const isFullYear = months.length === 12 && months.every((month, index) => month === String(index + 1).padStart(2, "0"));
  const label = `${monthNames[0]}-${monthNames[monthNames.length - 1]} ${year}`;
  return isFullYear ? label : `${label} (incomplete)`;
};

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
const seriesCadence = document.querySelector("#series-cadence");
const seriesDisplay = document.querySelector("#series-display");
const seriesMarket = document.querySelector("#series-market");
const seriesFuelButton = document.querySelector("#series-fuel-button");
const seriesFuelMenu = document.querySelector("#series-fuel-menu");
const seriesLegend = document.querySelector("#series-legend");
const seriesSummary = document.querySelector("#series-summary");
const seriesChart = document.querySelector("#series-chart");
const seriesTooltip = document.querySelector("#series-tooltip");
const START_YEAR_LABEL = "January 2020";

const SVG_NS = "http://www.w3.org/2000/svg";
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const METRIC_ORDER = ["generation", "emissions"];
const CADENCE_ORDER = ["monthly", "annual"];
const DISPLAY_ORDER = ["value", "share", "change"];
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
const ANNUAL_SERIES_PALETTE = YEAR_PALETTE.slice(0, 5);

const METRIC_CONFIG = {
  generation: {
    label: "Power generation",
    shortLabel: "Generation",
    unit: "TWh",
    valueKey: "power_generation_twh",
    shareKey: "power_share_pct",
  },
  emissions: {
    label: "Power sector emissions",
    shortLabel: "Emissions",
    unit: "MtCO2",
    valueKey: "power_sector_emissions_mtco2",
    shareKey: "emissions_share_pct",
  },
};

const CADENCE_CONFIG = {
  monthly: { label: "Monthly" },
  annual: { label: "Annual" },
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
  change: {
    label: "YoY change",
    axisLabel: () => "%",
    valueForRow: (row) => row.change_pct,
    formatForTooltip: (row) => formatDeltaPct(row.change_pct),
  },
};

let hiddenYears = new Set();
let selectedFuelTypes = new Set(["Coal"]);
let availableFuelTypes = [];

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

const getFuelSelectionLabel = (fuelTypes) => {
  const selected = fuelTypes.filter((fuel) => selectedFuelTypes.has(fuel));

  if (!selected.length) {
    return "Select fuels";
  }

  if (selected.length <= 2) {
    return selected.join(" + ");
  }

  return `${selected.length} fuels`;
};

const getSelectedFuelTypes = () => availableFuelTypes.filter((fuel) => selectedFuelTypes.has(fuel));

const filterRowsByFuelSelection = (rows) => rows.filter((row) => selectedFuelTypes.has(row.fuel_type));

const shiftBucketStart = (bucketStart, cadenceKey) => {
  const date = new Date(`${bucketStart}T00:00:00Z`);

  if (cadenceKey === "annual") {
    return `${date.getUTCFullYear() - 1}-01-01`;
  }

  return `${date.getUTCFullYear() - 1}-${bucketStart.slice(5)}`;
};

const annotateRowsWithPeriodChange = (rows, metricKey, cadenceKey) => {
  const metric = METRIC_CONFIG[metricKey];
  const sortedRows = rows
    .slice()
    .sort(
      (a, b) =>
        a.market.localeCompare(b.market) ||
        a.fuel_type.localeCompare(b.fuel_type) ||
        a.bucket_start.localeCompare(b.bucket_start)
    );
  const bySeriesAndBucket = new Map(
    sortedRows.map((row) => [`${row.market}__${row.fuel_type}__${row.bucket_start}`, row])
  );

  return sortedRows.map((row) => {
    const currentValue = row[metric.valueKey];
    const previousValue =
      cadenceKey === "annual" && Number.isFinite(row.comparison_value)
        ? row.comparison_value
        : bySeriesAndBucket.get(`${row.market}__${row.fuel_type}__${shiftBucketStart(row.bucket_start, cadenceKey)}`)
            ?.[metric.valueKey];
    const changePct =
      Number.isFinite(currentValue) && Number.isFinite(previousValue) && previousValue !== 0
        ? ((currentValue - previousValue) / previousValue) * 100
        : null;

    return { ...row, change_pct: changePct };
  });
};

const getFuelDashArray = (fuelType) => {
  const selected = getSelectedFuelTypes();
  const index = Math.max(selected.indexOf(fuelType), 0);
  const dashPatterns = [null, "10 6", "4 5", "14 5 4 5", "2 4", "12 4 2 4", "16 6", "6 4 2 4"];
  return dashPatterns[index % dashPatterns.length];
};

const getMonthlySeriesLabel = (row, hasMultipleFuels) =>
  hasMultipleFuels ? `${row.fuel_type} ${getRowYear(row)}` : String(getRowYear(row));

const latestRowsByMarketAndFuel = (rows) => {
  const byKey = new Map();

  rows.forEach((row) => {
    const key = `${row.market}__${row.fuel_type}`;
    const existing = byKey.get(key);

    if (!existing || new Date(row.observed_at).getTime() > new Date(existing.observed_at).getTime()) {
      byKey.set(key, row);
    }
  });

  return Array.from(byKey.values()).sort(
    (a, b) =>
      a.market.localeCompare(b.market) ||
      FUEL_ORDER.indexOf(a.fuel_type) - FUEL_ORDER.indexOf(b.fuel_type) ||
      a.fuel_type.localeCompare(b.fuel_type)
  );
};

const getPriorYearRow = (rows, targetRow) => {
  const [year, month] = targetRow.bucket_start.slice(0, 7).split("-");
  const priorBucket = `${Number(year) - 1}-${month}`;

  return rows.find(
    (row) =>
      row.market === targetRow.market &&
      row.fuel_type === targetRow.fuel_type &&
      row.bucket_start.slice(0, 7) === priorBucket
  );
};

const getLatestAnnualChangeByMarketAndFuel = (payload, metricKey) => {
  const result = new Map();

  Array.from(new Set((payload.rows ?? []).map((row) => row.market))).forEach((market) => {
    getSelectedFuelTypes().forEach((fuelType) => {
      const annualRows = buildAnnualRows(payload, metricKey, market, fuelType);
      const latestAnnualRow = annualRows[annualRows.length - 1];

      if (!latestAnnualRow) {
        return;
      }

      const annualChange =
        Number.isFinite(latestAnnualRow[METRIC_CONFIG[metricKey].valueKey]) &&
        Number.isFinite(latestAnnualRow.comparison_value) &&
        latestAnnualRow.comparison_value !== 0
          ? ((latestAnnualRow[METRIC_CONFIG[metricKey].valueKey] - latestAnnualRow.comparison_value) /
              latestAnnualRow.comparison_value) *
            100
          : null;

      result.set(`${market}__${fuelType}`, {
        change_pct: annualChange,
        period_label: latestAnnualRow.period_label,
      });
    });
  });

  return result;
};

const buildAnnualRowsForFuelSelection = (payload, metricKey, market) =>
  getSelectedFuelTypes().flatMap((fuelType) => buildAnnualRows(payload, metricKey, market, fuelType));

const buildAnnualRows = (payload, metricKey, market, fuelType) => {
  const metric = METRIC_CONFIG[metricKey];
  const marketRows = (payload.rows ?? []).filter((row) => row.market === market);
  const years = Array.from(new Set(marketRows.map((row) => row.bucket_start.slice(0, 4)))).sort();

  return years
    .map((year) => {
      const fuelRows = marketRows
        .filter((row) => row.fuel_type === fuelType && row.bucket_start.startsWith(`${year}-`))
        .filter((row) => Number.isFinite(row[metric.valueKey]))
        .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
      const totalRows = (
        fuelType === "Total generation"
          ? fuelRows
          : marketRows.filter(
              (row) =>
                row.fuel_type === "Total generation" &&
                row.bucket_start.startsWith(`${year}-`) &&
                Number.isFinite(row[metric.valueKey])
            )
      ).sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));

      const totalByMonth = new Map(totalRows.map((row) => [row.bucket_start.slice(5, 7), row]));
      const comparableFuelRows = fuelRows.filter((row) => totalByMonth.has(row.bucket_start.slice(5, 7)));
      const coveredMonths = comparableFuelRows.map((row) => row.bucket_start.slice(5, 7));

      if (!coveredMonths.length) {
        return null;
      }

      const comparableTotalRows =
        fuelType === "Total generation"
          ? comparableFuelRows
          : coveredMonths.map((month) => totalByMonth.get(month));
      const fuelValues = comparableFuelRows.map((row) => row[metric.valueKey]);
      const totalValues = comparableTotalRows.map((row) => row[metric.valueKey]);

      if (!fuelValues.every(Number.isFinite) || !totalValues.every(Number.isFinite)) {
        return null;
      }

      const annualValue = fuelValues.reduce((sum, value) => sum + value, 0);
      const annualTotal = totalValues.reduce((sum, value) => sum + value, 0);
      const previousYear = String(Number(year) - 1);
      const previousYearFuelRows = coveredMonths
        .map((month) =>
          marketRows.find(
            (row) =>
              row.fuel_type === fuelType &&
              row.bucket_start === `${previousYear}-${month}-01` &&
              Number.isFinite(row[metric.valueKey])
          )
        )
        .filter(Boolean);
      const comparisonValue =
        previousYearFuelRows.length === coveredMonths.length
          ? previousYearFuelRows.reduce((sum, row) => sum + row[metric.valueKey], 0)
          : null;

      return {
        market,
        fuel_type: fuelType,
        bucket_start: `${year}-01-01`,
        observed_at: `${year}-12-31T23:59:59.000Z`,
        [metric.valueKey]: annualValue,
        [metric.shareKey]: annualTotal > 0 ? (annualValue / annualTotal) * 100 : null,
        comparison_value: comparisonValue,
        covered_months: coveredMonths,
        period_label: formatAnnualCoverageLabel(coveredMonths, year),
        source: "Ember API",
        source_family: "Ember",
        source_label: "Ember API",
        connector: `ember-annual-${metricKey}`,
        is_proxy: false,
      };
    })
    .filter(Boolean);
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

const showSeriesTooltip = ({ row, metric, x, y, periodLabel }) => {
  const chartBounds = seriesChart.getBoundingClientRect();

  seriesTooltip.innerHTML = `
    <strong>${row.market}</strong>
    <div>Fuel: ${row.fuel_type}</div>
    <div>Period: ${periodLabel ?? row.period_label ?? formatBucketLabel(row.bucket_start)}</div>
    <div>${metric.label}: ${formatNumber(row[metric.valueKey])} ${metric.unit}</div>
    <div>Share: ${formatPct(row[metric.shareKey])}</div>
    <div>YoY Change: ${formatDeltaPct(row.change_pct)}</div>
    <div>Source: Ember API</div>
  `;

  seriesTooltip.style.left = `${(x / 960) * chartBounds.width + 12}px`;
  seriesTooltip.style.top = `${(y / 320) * chartBounds.height + 12}px`;
  seriesTooltip.hidden = false;
};

const renderLatestSnapshot = (payload, metricKey) => {
  const metric = METRIC_CONFIG[metricKey];

  if (!payload?.generatedAt || !Array.isArray(payload.rows)) {
    snapshotGeneratedAt.textContent = "Monthly export unavailable";
    return;
  }

  const selectedRows = filterRowsByFuelSelection(payload.rows);
  const latestAnnualChangeByMarketAndFuel = getLatestAnnualChangeByMarketAndFuel(payload, metricKey);
  snapshotGeneratedAt.textContent = `Ember monthly export generated ${formatTime(payload.generatedAt)}`;
  snapshotBody.replaceChildren();

  latestRowsByMarketAndFuel(selectedRows).forEach((row) => {
    const priorYearRow = getPriorYearRow(selectedRows, row);
    const currentValue = row[metric.valueKey];
    const priorValue = priorYearRow?.[metric.valueKey];
    const yoyChange =
      Number.isFinite(currentValue) && Number.isFinite(priorValue) && priorValue !== 0
        ? ((currentValue - priorValue) / priorValue) * 100
        : null;
    const latestAnnual = latestAnnualChangeByMarketAndFuel.get(`${row.market}__${row.fuel_type}`);
    const tableRow = document.createElement("tr");
    tableRow.innerHTML = `
      <td>${row.market}</td>
      <td>${row.fuel_type}</td>
      <td>${row.bucket_start.slice(0, 7)}</td>
      <td>${formatNumber(row[metric.valueKey])}</td>
      <td>${formatPct(row[metric.shareKey])}</td>
      <td>${formatTime(row.observed_at)}</td>
      <td>${formatDeltaPct(yoyChange)}</td>
      <td title="${latestAnnual?.period_label ?? ""}">${formatDeltaPct(latestAnnual?.change_pct ?? null)}</td>
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

const renderSeriesChart = (rows, metricKey, displayKey, cadenceKey) => {
  const metric = METRIC_CONFIG[metricKey];
  const display = DISPLAY_CONFIG[displayKey];
  const isAnnual = cadenceKey === "annual";
  const selectedFuels = getSelectedFuelTypes();
  const hasMultipleFuels = selectedFuels.length > 1;

  seriesChart.replaceChildren();
  hideSeriesTooltip();

  if (!rows.length) {
    renderSeriesLegend([], () => {});
    seriesSummary.hidden = true;
    return;
  }

  const width = 960;
  const height = 320;
  const margin = { top: 28, right: hasMultipleFuels ? 140 : 20, bottom: 48, left: 96 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const buckets = isAnnual
    ? Array.from(new Set(rows.map((row) => row.bucket_start.slice(0, 4)))).sort()
    : MONTH_LABELS.map((_, index) => index);
  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket, index]));
  const byYear = isAnnual ? new Map() : groupMonthlyRowsByYear(rows);
  const visibleYears = Array.from(byYear.keys()).filter((year) => !hiddenYears.has(year));
  const visibleRows = isAnnual ? rows : rows.filter((row) => visibleYears.includes(getRowYear(row)));
  const values = visibleRows.map((row) => display.valueForRow(row, metric)).filter((value) => Number.isFinite(value));

  const toggleYear = (label) => {
    const year = Number(label);
    if (hiddenYears.has(year)) {
      hiddenYears.delete(year);
    } else {
      hiddenYears.add(year);
    }

    renderSeriesChart(rows, metricKey, displayKey, cadenceKey);
  };

  if (!values.length) {
    if (!isAnnual) {
      const legendItems = Array.from(byYear.keys())
        .sort((a, b) => a - b)
        .map((year) => ({ label: String(year), color: getYearColor(year), hidden: hiddenYears.has(year) }));

      renderSeriesLegend(legendItems, toggleYear);
    } else {
      renderSeriesLegend([], () => {});
    }
    seriesSummary.hidden = true;
    return;
  }

  const { yMin, yMax } = getYAxisDomain(values, displayKey);
  const xStep = innerWidth / (Math.max(buckets.length, 2) - 1);

  const xForBucket = (bucket) => margin.left + xStep * bucketIndex.get(bucket);
  const xForRow = (row) => xForBucket(isAnnual ? row.bucket_start.slice(0, 4) : getRowMonthIndex(row));
  const yForValue = (value) => margin.top + innerHeight - ((value - yMin) / (yMax - yMin)) * innerHeight;

  const plot = createSvgNode("g");
  seriesChart.append(plot);

  if (displayKey === "change" && yMin < 0) {
    const zeroY = yForValue(0);
    plot.append(
      createSvgNode("rect", {
        x: margin.left,
        y: zeroY,
        width: innerWidth,
        height: height - margin.bottom - zeroY,
        fill: "rgba(127, 20, 42, 0.08)",
      })
    );
  }

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

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMin + ((yMax - yMin) / 4) * tick;
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
    label.textContent = formatAxisValue(value, Math.max(Math.abs(yMin), Math.abs(yMax)), display.axisLabel(metric));
    plot.append(label);
  }

  plot.append(
    createSvgNode("line", {
      x1: margin.left,
      y1: displayKey === "change" && yMin < 0 && yMax > 0 ? yForValue(0) : height - margin.bottom,
      x2: width - margin.right,
      y2: displayKey === "change" && yMin < 0 && yMax > 0 ? yForValue(0) : height - margin.bottom,
      stroke: "rgba(33, 28, 24, 0.24)",
      "stroke-width": 1.5,
    })
  );

  buckets.forEach((bucket) => {
    const x = xForBucket(bucket);

    plot.append(
      createSvgNode("line", {
        x1: x,
        y1: displayKey === "change" && yMin < 0 && yMax > 0 ? yForValue(0) : height - margin.bottom,
        x2: x,
        y2: (displayKey === "change" && yMin < 0 && yMax > 0 ? yForValue(0) : height - margin.bottom) + 6,
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
    label.textContent = isAnnual ? bucket : MONTH_LABELS[bucket];
    plot.append(label);
  });

  if (isAnnual) {
    const byFuel = new Map();

    rows.forEach((row) => {
      if (!byFuel.has(row.fuel_type)) {
        byFuel.set(row.fuel_type, []);
      }
      byFuel.get(row.fuel_type).push(row);
    });

    selectedFuels.forEach((fuelType, fuelIndex) => {
      const fuelRows = (byFuel.get(fuelType) ?? [])
        .slice()
        .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start))
        .filter((row) => Number.isFinite(display.valueForRow(row, metric)));
      const color = ANNUAL_SERIES_PALETTE[fuelIndex % ANNUAL_SERIES_PALETTE.length];
      const dashArray = getFuelDashArray(fuelType);
      const linePoints = fuelRows.map((row) => `${xForRow(row)},${yForValue(display.valueForRow(row, metric))}`).join(" ");

      if (!linePoints) {
        return;
      }

      const line = createSvgNode("polyline", {
        points: linePoints,
        fill: "none",
        stroke: color,
        "stroke-width": 4,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      });
      if (dashArray) {
        line.setAttribute("stroke-dasharray", dashArray);
      }
      plot.append(line);

      fuelRows.forEach((row) => {
        const plottedValue = display.valueForRow(row, metric);
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
        title.textContent = `${row.market}: ${display.formatForTooltip(row, metric)} in ${
          row.period_label ?? formatAnnualPeriodLabel(row.bucket_start)
        }`;
        circle.append(title);
        circle.addEventListener("mouseenter", () =>
          showSeriesTooltip({ row, metric, x, y, periodLabel: row.period_label })
        );
        circle.addEventListener("focus", () =>
          showSeriesTooltip({ row, metric, x, y, periodLabel: row.period_label })
        );
        circle.addEventListener("mouseleave", hideSeriesTooltip);
        circle.addEventListener("blur", hideSeriesTooltip);
        plot.append(circle);
      });

      if (hasMultipleFuels) {
        const lastRow = fuelRows[fuelRows.length - 1];
        const label = createSvgNode("text", {
          x: xForRow(lastRow) + 10,
          y: yForValue(display.valueForRow(lastRow, metric)) + 4,
          fill: color,
          "font-size": 11,
          "font-family": "IBM Plex Mono, monospace",
        });
        label.textContent = fuelType;
        plot.append(label);
      }
    });

    renderSeriesLegend([], () => {});
    seriesSummary.hidden = true;
    return;
  }

  const legendItems = [];
  const seriesRows = new Map();

  Array.from(byYear.keys())
    .sort((a, b) => a - b)
    .forEach((year) => {
      legendItems.push({ label: String(year), color: getYearColor(year), hidden: hiddenYears.has(year) });

      if (hiddenYears.has(year)) {
        return;
      }

      const yearRows = byYear.get(year).filter((row) => Number.isFinite(display.valueForRow(row, metric)));

      if (hasMultipleFuels) {
        selectedFuels.forEach((fuelType) => {
          const fuelRows = yearRows.filter((row) => row.fuel_type === fuelType);
          if (fuelRows.length) {
            seriesRows.set(`${fuelType}__${year}`, fuelRows);
          }
        });
      } else if (yearRows.length) {
        seriesRows.set(String(year), yearRows);
      }
    });

  Array.from(seriesRows.entries()).forEach(([seriesKey, seriesData]) => {
    const firstRow = seriesData[0];
    const year = getRowYear(firstRow);
    const color = getYearColor(year);
    const dashArray = hasMultipleFuels ? getFuelDashArray(firstRow.fuel_type) : null;
    const linePoints = seriesData.map((row) => `${xForRow(row)},${yForValue(display.valueForRow(row, metric))}`).join(" ");

    const line = createSvgNode("polyline", {
      points: linePoints,
      fill: "none",
      stroke: color,
      "stroke-width": 4,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    });
    if (dashArray) {
      line.setAttribute("stroke-dasharray", dashArray);
    }
    plot.append(line);

    seriesData.forEach((row) => {
      const plottedValue = display.valueForRow(row, metric);
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
      title.textContent = `${row.market}: ${display.formatForTooltip(row, metric)} in ${formatBucketLabel(
        row.bucket_start
      )}`;
      circle.append(title);
      circle.addEventListener("mouseenter", () => showSeriesTooltip({ row, metric, x, y }));
      circle.addEventListener("focus", () => showSeriesTooltip({ row, metric, x, y }));
      circle.addEventListener("mouseleave", hideSeriesTooltip);
      circle.addEventListener("blur", hideSeriesTooltip);
      plot.append(circle);
    });

    if (hasMultipleFuels) {
      const lastRow = seriesData[seriesData.length - 1];
      const label = createSvgNode("text", {
        x: xForRow(lastRow) + 10,
        y: yForValue(display.valueForRow(lastRow, metric)) + 4,
        fill: color,
        "font-size": 11,
        "font-family": "IBM Plex Mono, monospace",
      });
      label.textContent = getMonthlySeriesLabel(lastRow, true);
      plot.append(label);
    }
  });

  renderSeriesLegend(legendItems, toggleYear);
  seriesSummary.hidden = true;
};

const renderSeriesControls = (datasets) => {
  const generationPayload = datasets.generation;

  seriesMetric.replaceChildren();
  seriesCadence.replaceChildren();
  seriesDisplay.replaceChildren();
  seriesMarket.replaceChildren();

  const markets = Array.from(new Set((generationPayload.rows ?? []).map((row) => row.market))).sort(compareMarkets);
  const fuels = (generationPayload.fuelTypes ?? []).slice().sort((a, b) => {
    const ai = FUEL_ORDER.indexOf(a);
    const bi = FUEL_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
  });
  availableFuelTypes = fuels;

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

  CADENCE_ORDER.forEach((cadenceKey) => {
    const option = document.createElement("option");
    option.value = cadenceKey;
    option.textContent = CADENCE_CONFIG[cadenceKey].label;
    seriesCadence.append(option);
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

  seriesMetric.value = "generation";
  seriesCadence.value = "monthly";
  seriesDisplay.value = "value";
  seriesMarket.value = markets.includes("World")
    ? "World"
    : markets.includes("United States")
    ? "United States"
    : markets[0];
  selectedFuelTypes = new Set([fuels.includes("Coal") ? "Coal" : fuels[0]]);

  const updateFuelButton = () => {
    seriesFuelButton.textContent = getFuelSelectionLabel(fuels);
  };

  const closeFuelMenu = () => {
    seriesFuelMenu.hidden = true;
    seriesFuelButton.setAttribute("aria-expanded", "false");
  };

  const renderFuelMenu = () => {
    seriesFuelMenu.replaceChildren();

    fuels.forEach((fuel) => {
      const option = document.createElement("label");
      option.className = "fuel-filter-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selectedFuelTypes.has(fuel);
      input.value = fuel;
      input.addEventListener("change", () => {
        if (fuel === "Total generation" && input.checked) {
          selectedFuelTypes = new Set(["Total generation"]);
        } else if (fuel !== "Total generation" && input.checked) {
          selectedFuelTypes.delete("Total generation");
          selectedFuelTypes.add(fuel);
        } else if (selectedFuelTypes.size > 1) {
          selectedFuelTypes.delete(fuel);
        } else {
          input.checked = true;
          return;
        }

        renderFuelMenu();
        updateFuelButton();
        refreshSeries();
      });

      const text = document.createElement("span");
      text.textContent = fuel;

      option.append(input, text);
      seriesFuelMenu.append(option);
    });
  };

  const refreshSeries = () => {
    const activePayload = datasets[seriesMetric.value];
    const monthlyRows = filterRowsByFuelSelection(activePayload.rows ?? []);
    const baseRows =
      seriesCadence.value === "annual"
        ? buildAnnualRowsForFuelSelection(activePayload, seriesMetric.value, seriesMarket.value)
        : monthlyRows.filter((row) => row.market === seriesMarket.value);
    const filteredRows = annotateRowsWithPeriodChange(baseRows, seriesMetric.value, seriesCadence.value);

    hiddenYears = seriesCadence.value === "annual" ? new Set() : getDefaultHiddenYears(filteredRows);
    renderSeriesChart(filteredRows, seriesMetric.value, seriesDisplay.value, seriesCadence.value);
    renderLatestSnapshot(activePayload, seriesMetric.value);
    renderCoverage(activePayload);
  };

  renderFuelMenu();
  updateFuelButton();
  refreshSeries();
  seriesMetric.addEventListener("change", refreshSeries);
  seriesCadence.addEventListener("change", refreshSeries);
  seriesDisplay.addEventListener("change", refreshSeries);
  seriesMarket.addEventListener("change", refreshSeries);
  seriesFuelButton.addEventListener("click", () => {
    const isOpen = !seriesFuelMenu.hidden;
    seriesFuelMenu.hidden = isOpen;
    seriesFuelButton.setAttribute("aria-expanded", String(!isOpen));
  });
  document.addEventListener("click", (event) => {
    if (!seriesFuelMenu.hidden && !seriesFuelMenu.contains(event.target) && !seriesFuelButton.contains(event.target)) {
      closeFuelMenu();
    }
  });
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
  renderSeriesControls({
    generation: generationMonthly,
    emissions: emissionsMonthly,
  });
};

load().catch((error) => {
  console.error(error);
  schemaPreview.textContent = "Failed to load local Ember data files.";
});
