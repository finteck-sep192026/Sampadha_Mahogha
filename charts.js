// Charts: Chart.js 4 (vendored, loaded on first use) styled to one spec for the whole portal —
// columns at most 24px wide with 4px rounded data-ends square at the baseline, 2px surface gaps
// between stacked segments, solid hairline grid, no load animation (people read this data), one
// HTML tooltip per x that lists every series with the value first, a legend for two or more
// series, and a table view twin for every chart (the accessible equivalent).
// Series colours: sapphire then gold (dataviz validate_palette: lightness, chroma, CVD ΔE 31.4,
// normal ΔE 35.7, contrast ≥ 3:1), as the --chart-1/--chart-2 tokens, with a lighter step of each
// in dark mode. Canvas needs real colours, so they are read from the tokens at draw time and
// every chart on the page is redrawn when the mode changes.
let chartLibrary;
const chartInstances = new Map();
const chartData = new Map();
function chartColours() {
  const style = getComputedStyle(document.body),
    token = (name) => style.getPropertyValue(name).trim();
  return {
    series: [token('--chart-1'), token('--chart-2')],
    muted: token('--muted'),
    grid: token('--chart-grid'),
    surface: token('--surface'),
  };
}

function loadChartLibrary() {
  if (window.Chart) return Promise.resolve(window.Chart);
  chartLibrary ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/chart.umd.min.js';
    script.onload = () => resolve(window.Chart);
    script.onerror = () => {
      chartLibrary = null;
      reject(new Error('The chart could not load.'));
    };
    document.head.append(script);
  });
  return chartLibrary;
}

// Card markup for a chart; draw it with drawColumnChart(id, data) after it is in the page.
function chartCard({ id, title, subtitle = '', height = 240 }) {
  return `<figure class="card panel viz" id="${id}"><figcaption class="panel-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button type="button" class="btn secondary viz-toggle" data-viz-toggle="${id}" aria-pressed="false">Show table</button></figcaption><div class="viz-legend"></div><div class="viz-plot" style="height:${height}px"><canvas role="img"></canvas><div class="viz-tip" role="tooltip" hidden></div></div><div class="viz-table" hidden></div></figure>`;
}

// data: { labels: [...], series: [{ name, values: [...] }], unit: 'reports', empty: 'message' }
async function drawColumnChart(id, data) {
  const figure = document.getElementById(id);
  if (!figure) return;
  chartData.set(id, data);
  const canvas = figure.querySelector('canvas'),
    tip = figure.querySelector('.viz-tip'),
    total = (i) => data.series.reduce((sum, s) => sum + (s.values[i] || 0), 0);

  // Legend (rect swatches for bars) and table view, built with textContent: names are data.
  const legend = figure.querySelector('.viz-legend');
  legend.replaceChildren();
  if (data.series.length > 1)
    data.series.forEach((s, i) => {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = `var(--chart-${i + 1})`;
      item.append(swatch, document.createTextNode(s.name));
      legend.append(item);
    });
  const table = document.createElement('table');
  table.className = 'table';
  const head = table.createTHead().insertRow();
  ['Month', ...data.series.map((s) => s.name), 'Total'].forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  });
  const body = table.createTBody();
  data.labels.forEach((label, i) => {
    const row = body.insertRow();
    [label, ...data.series.map((s) => s.values[i] || 0), total(i)].forEach((v) => {
      row.insertCell().textContent = String(v);
    });
  });
  const tableWrap = figure.querySelector('.viz-table');
  tableWrap.replaceChildren(Object.assign(document.createElement('div'), { className: 'table-wrap' }));
  tableWrap.firstChild.append(table);
  canvas.setAttribute(
    'aria-label',
    figure.querySelector('h3').textContent +
      ': ' +
      data.labels.map((l, i) => `${l} ${total(i)}`).join(', ') +
      '. Use “Show table” for the full numbers.',
  );

  // Nothing to plot: say so plainly instead of drawing an empty axis.
  const plot = figure.querySelector('.viz-plot');
  if (data.labels.every((_, i) => !total(i))) {
    chartInstances.get(id)?.destroy();
    chartInstances.delete(id);
    plot.classList.add('viz-empty');
    plot.textContent = data.empty || 'Nothing to show for this period yet.';
    figure.querySelector('.viz-toggle').hidden = true;
    legend.replaceChildren();
    return;
  }
  let Chart;
  try {
    Chart = await loadChartLibrary();
  } catch (error) {
    plot.textContent = error.message + ' The table below has the numbers.';
    tableWrap.hidden = false;
    return;
  }
  chartInstances.get(id)?.destroy();
  const ink = chartColours();
  const font = { family: getComputedStyle(document.body).getPropertyValue('--font') || 'sans-serif', size: 12 };
  const last = data.series.length - 1;
  // The topmost non-zero segment of each column gets the rounded data-end.
  const topIndex = data.labels.map((_, i) => {
    for (let d = last; d >= 0; d--) if (data.series[d].values[i]) return d;
    return -1;
  });
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: data.series.map((s, d) => ({
        label: s.name,
        data: s.values,
        backgroundColor: ink.series[d],
        hoverBackgroundColor: ink.series[d] + 'd9',
        maxBarThickness: 24,
        categoryPercentage: 0.6,
        borderSkipped: false,
        borderColor: ink.surface,
        borderWidth: (ctx) => (d > 0 ? { bottom: 2 } : 0),
        borderRadius: (ctx) =>
          topIndex[ctx.dataIndex] === d ? { topLeft: 4, topRight: 4 } : 0,
      })),
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: ({ chart: c, tooltip: t }) => {
            if (!t.opacity || !t.dataPoints?.length) {
              tip.hidden = true;
              return;
            }
            const i = t.dataPoints[0].dataIndex;
            tip.replaceChildren();
            const title = document.createElement('b');
            title.textContent = data.labels[i];
            tip.append(title);
            data.series.forEach((s, d) => {
              const row = document.createElement('div');
              const key = document.createElement('i');
              key.style.background = `var(--chart-${d + 1})`;
              const value = document.createElement('strong');
              value.textContent = String(s.values[i] || 0);
              row.append(key, value, document.createTextNode(' ' + s.name));
              tip.append(row);
            });
            if (data.series.length > 1) {
              const sum = document.createElement('div');
              sum.className = 'viz-tip-total';
              sum.textContent = `${total(i)} ${data.unit || ''} in total`;
              tip.append(sum);
            }
            tip.hidden = false;
            const x = Math.min(Math.max(t.caretX, tip.offsetWidth / 2 + 4), c.width - tip.offsetWidth / 2 - 4);
            tip.style.left = x + 'px';
            tip.style.top = Math.max(t.caretY - tip.offsetHeight - 12, 0) + 'px';
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { color: ink.grid },
          ticks: { color: ink.muted, font },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          border: { display: false },
          grid: { color: ink.grid, lineWidth: 1, drawTicks: false },
          ticks: { color: ink.muted, font, precision: 0, maxTicksLimit: 5, padding: 8 },
        },
      },
    },
  });
  chartInstances.set(id, chart);
  canvas.addEventListener('mouseleave', () => (tip.hidden = true));
}

// Meter: one ratio against its whole; the track is a quiet step of the same blue.
function meterRow(label, part, whole) {
  const share = whole ? Math.round((part / whole) * 100) : 0;
  return `<div class="meter"><div class="meter-head"><span>${esc(label)}</span><b>${part} of ${whole}</b><small>${share}%</small></div><div class="meter-track" role="meter" aria-valuemin="0" aria-valuemax="${whole}" aria-valuenow="${part}" aria-label="${esc(label)}"><span style="width:${share}%"></span></div></div>`;
}

document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-viz-toggle]');
  if (!toggle) return;
  const figure = document.getElementById(toggle.dataset.vizToggle),
    table = figure.querySelector('.viz-table'),
    showing = table.hidden;
  table.hidden = !showing;
  toggle.setAttribute('aria-pressed', String(showing));
  toggle.textContent = showing ? 'Hide table' : 'Show table';
});

// Light/dark switch (theme-mode.js): redraw the charts that are on the page in the new colours.
window.addEventListener('sampadha:mode', () => {
  for (const [id, data] of chartData) {
    if (document.getElementById(id)) drawColumnChart(id, data);
    else chartData.delete(id);
  }
});
