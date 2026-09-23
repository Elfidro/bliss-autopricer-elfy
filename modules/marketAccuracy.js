// Scores the pricelist against the live backpack.tf market held in tf2.listings
// (the websocket mirror), so the pricer's accuracy can be tracked over time
// without polling backpack.tf.
//
// For each priced item:
//   bid = highest buy order, ignoring buy orders priced above the lowest sell
//         listing (those are for painted/spelled variants, not the base item)
//   ask = lowest sell listing
// and the pricer's buy/sell are judged against them.

const fs = require('fs');
const path = require('path');
const { getBaseConfigManager } = require('./baseConfigManager');

const PRICELIST_PATH = path.resolve(__dirname, '../files/pricelist.json');

const toMetal = (c, keyMetal) => (Number(c?.keys) || 0) * keyMetal + (Number(c?.metal) || 0);
const r2 = (x) => Math.round(x * 100) / 100;

// Tolerances: a sell within 3% (min one scrap) of the lowest ask and a buy
// within 5% (min two scrap) of the best bid count as on the market.
const sellTolerance = (ask) => Math.max(0.11, ask * 0.03);
const buyTolerance = (bid) => Math.max(0.22, bid * 0.05);

function classify(row) {
  if (row.bid == null || row.ask == null) {
    return 'no-market';
  }
  if (row.buy >= row.ask) {
    return 'overpay';
  }
  if (row.sell <= row.bid) {
    return 'underprice';
  }
  const sellHigh = row.sell > row.ask + sellTolerance(row.ask);
  const buyLow = row.buy < row.bid - buyTolerance(row.bid);
  if (sellHigh && buyLow) {
    return 'too-wide';
  }
  if (sellHigh) {
    return 'sell-high';
  }
  if (buyLow) {
    return 'buy-low';
  }
  return 'ok';
}

async function computeAccuracy(db) {
  const config = getBaseConfigManager().getConfig();
  const own = new Set([...(config.ownBotSteamIDs || []), ...(config.excludedSteamIDs || [])]);
  const pricelist = JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8')).items || [];
  const keyEntry = pricelist.find((i) => i.sku === '5021;6');
  const keyMetal = Number(keyEntry?.sell?.metal) || 60;

  const listings = await db.any('SELECT name, intent, currencies, steamid FROM listings');
  const market = new Map();
  for (const l of listings) {
    if (own.has(l.steamid)) {
      continue;
    }
    const price = toMetal(typeof l.currencies === 'string' ? JSON.parse(l.currencies) : l.currencies, keyMetal);
    if (!(price > 0)) {
      continue;
    }
    let m = market.get(l.name);
    if (!m) {
      m = { buy: [], sell: [] };
      market.set(l.name, m);
    }
    (l.intent === 'buy' ? m.buy : m.sell).push(price);
  }

  const now = Date.now() / 1000;
  const rows = [];
  for (const item of pricelist) {
    if (item.sku === '5021;6') {
      continue;
    }
    const m = market.get(item.name) || market.get('The ' + item.name) || { buy: [], sell: [] };
    const ask = m.sell.length ? Math.min(...m.sell) : null;
    const buys = ask == null ? m.buy : m.buy.filter((p) => p <= ask);
    const bid = buys.length ? Math.max(...buys) : null;
    const row = {
      name: item.name,
      sku: item.sku,
      buy: r2(toMetal(item.buy, keyMetal)),
      sell: r2(toMetal(item.sell, keyMetal)),
      bid: bid == null ? null : r2(bid),
      ask: ask == null ? null : r2(ask),
      nBuy: buys.length,
      nSell: m.sell.length,
      ageSec: Math.max(0, Math.round(now - item.time)),
    };
    row.state = classify(row);
    if (row.bid != null && row.ask != null) {
      const mid = (row.bid + row.ask) / 2;
      row.errPct = r2((((row.buy + row.sell) / 2 - mid) / mid) * 100);
    } else {
      row.errPct = null;
    }
    rows.push(row);
  }

  const withMarket = rows.filter((r) => r.state !== 'no-market');
  const errs = withMarket.map((r) => Math.abs(r.errPct)).sort((a, b) => a - b);
  const count = (s) => rows.filter((r) => r.state === s).length;
  const summary = {
    items: rows.length,
    withMarket: withMarket.length,
    ok: count('ok'),
    overpay: count('overpay'),
    underprice: count('underprice'),
    sellHigh: count('sell-high'),
    buyLow: count('buy-low'),
    tooWide: count('too-wide'),
    noMarket: count('no-market'),
    fresh1h: rows.filter((r) => r.ageSec < 3600).length,
    stale24h: rows.filter((r) => r.ageSec >= 86400).length,
    medianErrPct: errs.length ? r2(errs[Math.floor(errs.length / 2)]) : null,
    keyMetal,
  };
  return { summary, rows };
}

async function ensureAccuracyTable(db) {
  await db.none(`
    CREATE TABLE IF NOT EXISTS pricer_accuracy (
      ts timestamptz NOT NULL DEFAULT now(),
      items integer NOT NULL,
      with_market integer NOT NULL,
      ok integer NOT NULL,
      overpay integer NOT NULL,
      underprice integer NOT NULL,
      sell_high integer NOT NULL,
      buy_low integer NOT NULL,
      too_wide integer NOT NULL,
      fresh_1h integer NOT NULL,
      median_err numeric
    )`);
}

// Called after every pricing cycle.
async function recordAccuracy(db) {
  const { summary: s } = await computeAccuracy(db);
  await ensureAccuracyTable(db);
  await db.none(
    `INSERT INTO pricer_accuracy
       (items, with_market, ok, overpay, underprice, sell_high, buy_low, too_wide, fresh_1h, median_err)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [s.items, s.withMarket, s.ok, s.overpay, s.underprice, s.sellHigh, s.buyLow, s.tooWide, s.fresh1h, s.medianErrPct]
  );
  console.log(
    `[ACCURACY] ${s.ok}/${s.withMarket} items on the market (${s.overpay} overpay, ` +
      `${s.underprice} underprice, ${s.sellHigh} sell high, ${s.buyLow} buy low, ${s.tooWide} too wide), ` +
      `median error ${s.medianErrPct}%`
  );
  return s;
}

async function getAccuracyHistory(db, days = 7) {
  await ensureAccuracyTable(db);
  return db.any(
    `SELECT ts, items, with_market, ok, overpay, underprice, sell_high, buy_low, too_wide, fresh_1h, median_err
       FROM pricer_accuracy
      WHERE ts > now() - ($1 || ' days')::interval
      ORDER BY ts`,
    [String(days)]
  );
}

module.exports = { computeAccuracy, recordAccuracy, getAccuracyHistory, classify };
