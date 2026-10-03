// Scores the pricelist against the live backpack.tf market held in tf2.listings
// (the websocket mirror), so the pricer's accuracy can be tracked over time
// without polling backpack.tf.
//
// For each priced item the market is read with chooseMarket, the same model the
// pricer prices by (modules/marketPrice.js), so the scorer and the pricer never
// disagree about where the market is:
//   bid = the supported best bid among the real bids (buy orders far above
//         the ask are for painted/spelled variants, not the base item)
//   ask = where the market sells: the market ask (the lowest sell listing, or
//         the next one up when the lowest is an isolated undercut), or, when
//         the market is locked (best bid >= ask), the first ask above the best
//         bid, or the bid plus the sell margin when there is no usable one. A
//         locked row is flagged with `locked`.
// and the pricer's buy/sell are judged against them.

const fs = require('fs');
const path = require('path');
const { getBaseConfigManager } = require('./baseConfigManager');
const { chooseMarket, marketOptions } = require('./marketPrice');
const { loadAnchors, hardBuyCap } = require('./historyAnchor');

const PRICELIST_PATH = path.resolve(__dirname, '../files/pricelist.json');

const toMetal = (c, keyMetal) => (Number(c?.keys) || 0) * keyMetal + (Number(c?.metal) || 0);
const r2 = (x) => Math.round(x * 100) / 100;

// Tolerances: a sell within 2% (min one scrap) of the market ask and a buy
// within 2% (min one scrap) of the best bid count as on the market. The buy
// side used to allow 5% (min two scrap), which scored Backpack Expander's 29
// ref buy under a 29.88 ref best bid as "ok" on a 30 ref item that trades
// every few minutes - a buy that never wins an item.
const sellTolerance = (ask) => Math.max(0.11, ask * 0.02);
const buyTolerance = (bid) => Math.max(0.11, bid * 0.02);

const isNil = (v) => v === null || v === undefined;

// Strict comparisons on purpose: buying exactly where the market sells or
// selling exactly at the best bid is on the market, not over/under it.
function classify(row) {
  if (isNil(row.bid) || isNil(row.ask)) {
    return 'no-market';
  }
  if (row.buy > row.ask) {
    return 'overpay';
  }
  if (row.sell < row.bid) {
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
    const price = toMetal(
      typeof l.currencies === 'string' ? JSON.parse(l.currencies) : l.currencies,
      keyMetal
    );
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
  const opts = marketOptions(config);
  // The same 24 h history anchor the pricer reads, so bids the pricer ignores
  // as pumped are not the "best bid" here either.
  let anchors = new Map();
  if (config.historyAnchor?.enabled !== false) {
    try {
      anchors = await loadAnchors(db, config.historyAnchor);
    } catch (err) {
      console.error('[ACCURACY] could not load the 24 h price anchors:', err.message);
    }
  }
  const rows = [];
  for (const item of pricelist) {
    if (item.sku === '5021;6') {
      continue;
    }
    const m = market.get(item.name) || market.get('The ' + item.name) || { buy: [], sell: [] };
    const asks = m.sell.slice().sort((a, b) => a - b);
    const anchor = anchors.get(item.sku);
    const mk = chooseMarket(asks, m.buy, {
      ...opts,
      anchorSell: anchor ? anchor.sell : null,
      hardBuyCap: hardBuyCap(anchor, config.historyAnchor),
    });
    // Where the market sells (chooseMarket's sell): the market ask, or the
    // next ask / bid + margin when locked. null only with no asks at all.
    const ask = mk.sell;
    const row = {
      name: item.name,
      sku: item.sku,
      buy: r2(toMetal(item.buy, keyMetal)),
      sell: r2(toMetal(item.sell, keyMetal)),
      bid: isNil(mk.bid) ? null : r2(mk.bid),
      ask: isNil(ask) ? null : r2(ask),
      locked: mk.locked,
      nBuy: mk.nBids,
      nSell: m.sell.length,
      ageSec: Math.max(0, Math.round(now - item.time)),
    };
    row.state = classify(row);
    if (!isNil(row.bid) && !isNil(row.ask)) {
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
    [
      s.items,
      s.withMarket,
      s.ok,
      s.overpay,
      s.underprice,
      s.sellHigh,
      s.buyLow,
      s.tooWide,
      s.fresh1h,
      s.medianErrPct,
    ]
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
