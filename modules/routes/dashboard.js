const path = require('path');
const renderPage = require('../layout');
const { loadJson } = require('../utils');
const { db } = require('../dbInstance');
const { getBaseConfigManager } = require('../baseConfigManager');
const { computeAccuracy, getAccuracyHistory } = require('../marketAccuracy');
const { getStatus } = require('../pricingStatus');

// What each market state means, in the order the filter chips show them.
const STATES = {
  overpay: { label: 'Overpaying', badge: 'danger', help: 'Buy price is at or above the lowest ask' },
  underprice: { label: 'Underpriced', badge: 'danger', help: 'Sell price is at or below the best bid' },
  'too-wide': { label: 'Too wide', badge: 'warn', help: 'Sell above the ask and buy under the bid' },
  'sell-high': { label: 'Sell high', badge: 'warn', help: 'Sell more than 3% above the lowest ask' },
  'buy-low': { label: 'Buy low', badge: 'warn', help: 'Buy more than 5% under the best bid' },
  ok: { label: 'On market', badge: 'ok', help: 'Buy near the best bid, sell near the lowest ask' },
  'no-market': { label: 'No market', badge: 'muted', help: 'Not enough live listings to judge' },
};

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// Profit of a set of accepted trades, in ref.
function profitOf(trades, keyPrice) {
  let total = 0;
  for (const trade of trades) {
    const our = trade.value?.our || { keys: 0, metal: 0 };
    const their = trade.value?.their || { keys: 0, metal: 0 };
    if (our.total !== undefined && their.total !== undefined) {
      total += their.total / 9 - our.total / 9;
    } else {
      total +=
        (their.keys || 0) * keyPrice + (their.metal || 0) - ((our.keys || 0) * keyPrice + (our.metal || 0));
    }
  }
  return total;
}

function loadTrades(configManager) {
  const selectedBot = configManager?.getSelectedBot();
  const pollDataPath = selectedBot?.polldataPath || path.resolve(__dirname, '../../polldata.json');
  try {
    const pollData = loadJson(pollDataPath);
    if (!pollData?.offerData) {
      return [];
    }
    const owners = new Set(getBaseConfigManager().getConfig().botOwnerSteamIDs || []);
    return Object.values(pollData.offerData).filter((t) => t.isAccepted && !(t.partner && owners.has(t.partner)));
  } catch (error) {
    console.log('Could not load polldata.json:', error.message || error);
    return [];
  }
}

module.exports = function (app, configManager) {
  app.get('/dashboard', async (req, res) => {
    try {
      const config = getBaseConfigManager().getConfig();
      const externalLinks = config.externalLinks || {};
      const chartJsUrl = externalLinks.chartJsCdnUrl || 'https://cdn.jsdelivr.net/npm/chart.js';

      // --- Pricer accuracy against the live market ---------------------------
      const { summary: s, rows } = await computeAccuracy(db);
      const history = await getAccuracyHistory(db, 7);
      for (const row of rows) {
        const st = getStatus(row.name);
        row.lastRun = st ? st.status : null;
        row.reason = st ? st.reason : '';
      }
      const rank = Object.keys(STATES);
      rows.sort(
        (a, b) =>
          rank.indexOf(a.state) - rank.indexOf(b.state) || Math.abs(b.errPct || 0) - Math.abs(a.errPct || 0)
      );

      const accuracy = pct(s.ok, s.withMarket);
      const danger = s.overpay + s.underprice;
      const accClass = accuracy >= 70 ? 'stat-ok' : accuracy >= 40 ? 'stat-warn' : 'stat-danger';

      // --- Trading summary (selected bot) -----------------------------------
      const trades = loadTrades(configManager);
      const now = Date.now();
      const trades24h = trades.filter((t) => t.time * 1000 > now - 86400000);
      const trades7d = trades.filter((t) => t.time * 1000 > now - 7 * 86400000);
      const keyPrice = s.keyMetal;
      const profit24h = profitOf(trades24h, keyPrice);
      const profit7d = profitOf(trades7d, keyPrice);
      const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} ref`;

      const counts = {};
      for (const r of rows) {
        counts[r.state] = (counts[r.state] || 0) + 1;
      }
      const lastRuns = {};
      for (const r of rows) {
        if (r.lastRun) {
          lastRuns[r.lastRun] = (lastRuns[r.lastRun] || 0) + 1;
        }
      }

      const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

      let html = `
      <style>
        .acc-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
        .acc-chip { border: 1px solid var(--border); background: var(--surface-alt); color: var(--text);
          border-radius: 999px; padding: 5px 12px; font-size: 0.82rem; cursor: pointer; }
        .acc-chip.active { border-color: var(--accent); background: var(--accent-subtle); color: var(--accent); font-weight: 700; }
        .acc-tools { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 14px 24px 0; }
        .acc-tools input { flex: 1; min-width: 180px; padding: 8px 12px; border-radius: var(--radius);
          border: 1px solid var(--border); background: var(--surface); color: var(--text); }
        .acc-table-wrap { overflow-x: auto; max-height: 640px; overflow-y: auto; }
        .acc-table td, .acc-table th { padding: 9px 12px; white-space: nowrap; }
        .acc-table td.num, .acc-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
        .acc-table th { position: sticky; top: 0; z-index: 1; cursor: pointer; }
        .acc-bad { color: var(--danger-text); font-weight: 700; }
        .acc-warn { color: var(--warn-text); font-weight: 600; }
        .acc-reason { color: var(--text-muted); font-size: 0.82rem; white-space: normal; min-width: 180px; }
        .acc-chart { position: relative; height: 260px; }
        .acc-grid2 { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; margin-bottom: 24px; }
        @media (max-width: 960px) { .acc-grid2 { grid-template-columns: 1fr; } }
        .acc-legend div { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0;
          border-bottom: 1px solid var(--border); font-size: 0.88rem; }
      </style>
      <div style="max-width: 1560px; margin: 0 auto;">
        <div style="margin-bottom: 22px;">
          <h1 style="font-size: 1.9rem; font-weight: 800; margin-bottom: 6px;">Pricer Dashboard</h1>
          <p style="margin: 0; font-size: 0.95rem; color: var(--text-muted);">
            How the autopricer's prices compare with the live backpack.tf market (best bid and lowest ask from
            the listing feed, own bots excluded). Scored after every pricing cycle.
          </p>
        </div>

        <div class="stats-grid">
          <div class="stat-card ${accClass}">
            <div class="stat-top"><span class="stat-title">On market</span><div class="stat-icon-wrapper">🎯</div></div>
            <div class="stat-value">${accuracy}%</div>
            <p class="stat-desc">${s.ok} of ${s.withMarket} items with a live market</p>
          </div>
          <div class="stat-card ${s.medianErrPct != null && s.medianErrPct <= 5 ? 'stat-ok' : 'stat-warn'}">
            <div class="stat-top"><span class="stat-title">Median error</span><div class="stat-icon-wrapper">📏</div></div>
            <div class="stat-value">${s.medianErrPct == null ? '—' : s.medianErrPct + '%'}</div>
            <p class="stat-desc">Our mid-price vs the market mid-price</p>
          </div>
          <div class="stat-card ${danger === 0 ? 'stat-ok' : 'stat-danger'}">
            <div class="stat-top"><span class="stat-title">Losing trades risk</span><div class="stat-icon-wrapper">⚠️</div></div>
            <div class="stat-value">${danger}</div>
            <p class="stat-desc">${s.overpay} overpaying, ${s.underprice} underpriced</p>
          </div>
          <div class="stat-card ${pct(s.fresh1h, s.items) >= 60 ? 'stat-ok' : 'stat-warn'}">
            <div class="stat-top"><span class="stat-title">Updated last hour</span><div class="stat-icon-wrapper">⏱️</div></div>
            <div class="stat-value">${s.fresh1h}/${s.items}</div>
            <p class="stat-desc">${s.stale24h} not updated for over a day</p>
          </div>
        </div>

        <div class="acc-grid2">
          <div class="ui-card" style="margin-bottom: 0;">
            <div class="ui-card-header">
              <h3 style="margin: 0; font-size: 1.15rem;">📈 Accuracy over the last 7 days</h3>
              <span class="badge badge-info">${history.length} cycles</span>
            </div>
            ${
              history.length < 2
                ? '<div style="padding: 60px 12px; text-align: center; color: var(--text-dim);">The trend fills in as pricing cycles run (one every ~15 minutes).</div>'
                : '<div class="acc-chart"><canvas id="accChart"></canvas></div>'
            }
          </div>
          <div class="ui-card" style="margin-bottom: 0;">
            <div class="ui-card-header"><h3 style="margin: 0; font-size: 1.15rem;">🧭 Where prices sit</h3></div>
            <div class="acc-legend">
              ${rank
                .map(
                  (k) =>
                    `<div><span><span class="badge badge-${STATES[k].badge}">${STATES[k].label}</span>
                     <span style="color: var(--text-muted); font-size: 0.8rem; margin-left: 6px;">${STATES[k].help}</span></span>
                     <strong>${counts[k] || 0}</strong></div>`
                )
                .join('')}
            </div>
            <div style="margin-top: 14px; font-size: 0.82rem; color: var(--text-muted);">
              Last cycle: ${lastRuns.updated || 0} updated, ${lastRuns.rejected || 0} rejected,
              ${lastRuns['swing-held'] || 0} held by swing guard, ${lastRuns['swing-confirmed'] || 0} large moves accepted,
              ${lastRuns.error || 0} errors.
            </div>
          </div>
        </div>

        <div class="table-container">
          <div class="table-header-bar">
            <div>
              <h3>🔎 Items vs market</h3>
              <p style="color: var(--text-muted);">Worst first. Click a column to sort. Prices in ref (1 key = ${keyPrice} ref).</p>
            </div>
          </div>
          <div class="acc-tools">
            <input id="accSearch" type="search" placeholder="Filter by name…">
          </div>
          <div style="padding: 12px 24px 0;">
            <div class="acc-chips" id="accChips"></div>
          </div>
          <div class="acc-table-wrap">
            <table class="acc-table">
              <thead><tr>
                <th data-k="name">Item</th>
                <th data-k="state">State</th>
                <th data-k="buy" class="num">Our buy</th>
                <th data-k="bid" class="num">Best bid</th>
                <th data-k="sell" class="num">Our sell</th>
                <th data-k="ask" class="num">Lowest ask</th>
                <th data-k="errPct" class="num">Error</th>
                <th data-k="nBuy" class="num">Bids/Asks</th>
                <th data-k="ageSec" class="num">Updated</th>
                <th data-k="reason">Last pricing run</th>
              </tr></thead>
              <tbody id="accBody"></tbody>
            </table>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card ${profit24h >= 0 ? 'stat-ok' : 'stat-danger'}">
            <div class="stat-top"><span class="stat-title">24h profit</span><div class="stat-icon-wrapper">💰</div></div>
            <div class="stat-value">${signed(profit24h)}</div>
            <p class="stat-desc">${trades24h.length} trades, selected bot</p>
          </div>
          <div class="stat-card ${profit7d >= 0 ? 'stat-ok' : 'stat-danger'}">
            <div class="stat-top"><span class="stat-title">7-day profit</span><div class="stat-icon-wrapper">📊</div></div>
            <div class="stat-value">${signed(profit7d)}</div>
            <p class="stat-desc">${trades7d.length} trades · <a href="/pnl">details</a></p>
          </div>
        </div>
      </div>

      <script>
      (function () {
        const STATES = ${safeJson(STATES)};
        const ORDER = ${safeJson(rank)};
        const rows = ${safeJson(rows)};
        const history = ${safeJson(history)};
        let filter = 'all', query = '', sortKey = null, sortDir = 1;

        const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const fmt = (v) => (v == null ? '—' : Number(v).toFixed(2));
        const age = (sec) => sec < 3600 ? Math.round(sec / 60) + 'm' : sec < 86400 ? Math.round(sec / 3600) + 'h' : Math.round(sec / 86400) + 'd';
        const RUN = { updated: 'Updated', rejected: 'Rejected', 'swing-held': 'Held', 'swing-confirmed': 'Move accepted', error: 'Error' };

        function renderChips() {
          const counts = {};
          rows.forEach((r) => (counts[r.state] = (counts[r.state] || 0) + 1));
          const chips = [['all', 'All', rows.length]].concat(ORDER.filter((k) => counts[k]).map((k) => [k, STATES[k].label, counts[k]]));
          document.getElementById('accChips').innerHTML = chips
            .map(([k, label, n]) => '<button class="acc-chip' + (filter === k ? ' active' : '') + '" data-f="' + k + '">' + label + ' · ' + n + '</button>')
            .join('');
        }

        function cellClass(r, side) {
          if (side === 'buy' && r.state === 'overpay') return 'acc-bad';
          if (side === 'sell' && r.state === 'underprice') return 'acc-bad';
          if (side === 'buy' && (r.state === 'buy-low' || r.state === 'too-wide')) return 'acc-warn';
          if (side === 'sell' && (r.state === 'sell-high' || r.state === 'too-wide')) return 'acc-warn';
          return '';
        }

        function renderTable() {
          let list = rows.filter((r) => (filter === 'all' || r.state === filter) && r.name.toLowerCase().includes(query));
          if (sortKey) {
            list = list.slice().sort((a, b) => {
              let x = a[sortKey], y = b[sortKey];
              if (sortKey === 'state') { x = ORDER.indexOf(x); y = ORDER.indexOf(y); }
              if (sortKey === 'errPct') { x = x == null ? -1 : Math.abs(x); y = y == null ? -1 : Math.abs(y); }
              if (x == null) return 1; if (y == null) return -1;
              return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
            });
          }
          document.getElementById('accBody').innerHTML = list.length
            ? list.map((r) => {
                const st = STATES[r.state];
                const run = r.lastRun ? '<strong>' + RUN[r.lastRun] + '</strong>' + (r.reason ? ' — ' + esc(r.reason) : '') : '<span style="opacity:.6">not run since restart</span>';
                const err = r.errPct == null ? '—' : (r.errPct > 0 ? '+' : '') + r.errPct.toFixed(1) + '%';
                return '<tr>' +
                  '<td>' + esc(r.name) + '</td>' +
                  '<td><span class="badge badge-' + st.badge + '" title="' + esc(st.help) + '">' + st.label + '</span></td>' +
                  '<td class="num ' + cellClass(r, 'buy') + '">' + fmt(r.buy) + '</td>' +
                  '<td class="num">' + fmt(r.bid) + '</td>' +
                  '<td class="num ' + cellClass(r, 'sell') + '">' + fmt(r.sell) + '</td>' +
                  '<td class="num">' + fmt(r.ask) + '</td>' +
                  '<td class="num">' + err + '</td>' +
                  '<td class="num">' + r.nBuy + ' / ' + r.nSell + '</td>' +
                  '<td class="num">' + age(r.ageSec) + '</td>' +
                  '<td class="acc-reason">' + run + '</td>' +
                '</tr>';
              }).join('')
            : '<tr><td colspan="10" style="text-align:center; padding: 30px; color: var(--text-dim);">No items match.</td></tr>';
        }

        document.getElementById('accChips').addEventListener('click', (e) => {
          const f = e.target.closest('[data-f]');
          if (!f) return;
          filter = f.dataset.f;
          renderChips();
          renderTable();
        });
        document.getElementById('accSearch').addEventListener('input', (e) => {
          query = e.target.value.trim().toLowerCase();
          renderTable();
        });
        document.querySelectorAll('.acc-table th[data-k]').forEach((th) =>
          th.addEventListener('click', () => {
            const k = th.dataset.k;
            sortDir = sortKey === k ? -sortDir : 1;
            sortKey = k;
            renderTable();
          })
        );
        renderChips();
        renderTable();

        const canvas = document.getElementById('accChart');
        if (canvas && history.length >= 2) {
          const s = document.createElement('script');
          s.src = ${safeJson(chartJsUrl)};
          s.onload = () => {
            const css = getComputedStyle(document.documentElement);
            const color = (v, f) => (css.getPropertyValue(v) || f).trim();
            const labels = history.map((h) => new Date(h.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
            new Chart(canvas, {
              type: 'line',
              data: {
                labels,
                datasets: [
                  { label: 'On market %', data: history.map((h) => (h.with_market ? Math.round((h.ok / h.with_market) * 100) : null)),
                    borderColor: color('--ok', '#10b981'), backgroundColor: 'transparent', tension: 0.25, pointRadius: 0, yAxisID: 'y' },
                  { label: 'Median error %', data: history.map((h) => (h.median_err == null ? null : Number(h.median_err))),
                    borderColor: color('--warn', '#f59e0b'), backgroundColor: 'transparent', tension: 0.25, pointRadius: 0, yAxisID: 'y1' },
                  { label: 'Overpay + underprice', data: history.map((h) => h.overpay + h.underprice),
                    borderColor: color('--danger', '#ef4444'), backgroundColor: 'transparent', tension: 0.25, pointRadius: 0, yAxisID: 'y1' },
                ],
              },
              options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: color('--text-muted', '#888') } } },
                scales: {
                  x: { ticks: { color: color('--text-muted', '#888'), maxTicksLimit: 8 }, grid: { display: false } },
                  y: { min: 0, max: 100, position: 'left', ticks: { color: color('--text-muted', '#888') }, title: { display: true, text: 'On market %', color: color('--text-muted', '#888') } },
                  y1: { min: 0, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: color('--text-muted', '#888') } },
                },
              },
            });
          };
          document.body.appendChild(s);
        }
      })();
      </script>`;

      res.send(renderPage('Dashboard', html));
    } catch (error) {
      console.error('Dashboard error:', error);
      res
        .status(500)
        .send(renderPage('Error', '<div class="flash flash-error">Error loading dashboard: ' + error.message + '</div>'));
    }
  });
};
