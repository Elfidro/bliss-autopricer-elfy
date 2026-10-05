// A 24 h history anchor: the median of the pricer's own recent prices per SKU.
//
// Lia lost ~700 ref on Sep 28-30 to a pumped buy price. Snug Sharpshooter
// (31516;6) had been a 3.3 ref item for weeks. Someone bought out the honest
// asks, which left only junk asks at 45-50 ref, and then walked the bids up.
// The variant-bid ceiling sat at 49 ref, so every fake bid passed. Five fake
// bids and three junk asks made the market "deep", which skipped the
// backpack.tf baseline. The swing guard only sees one cycle's step: the buy
// crept 4.44 -> 6.5 ref in 1-3% steps over 16 hours, then jumped to 18.16
// and was "persisted, accepting" after four cycles. Lia bought 35 at 6.40
// and 15 at 22.20. Bigger Mann on Campus went the same way a day earlier
// (buy 5.6 -> 9.7 -> 22.05) and so did Cozy Cover-Up (8.8 -> 29).
//
// What the anchor limits (see anchorCeiling / rampCap / sellFloor):
//   - bids far above our own recent sell price are not bids for this item
//     (or are bait), so they are dropped;
//   - the buy may rise at most maxBuyRisePct (or maxBuyRiseMetal) over the
//     window's median buy, so a creep takes days instead of hours;
//   - the sell may fall at most maxSellDropPct (or maxSellDropMetal) under
//     the window's median sell. The mirror attack: three fake cheap asks
//     would otherwise pull our sell down within an hour (only the swing
//     guard's four-cycle hold stood in the way) and let the lister buy our
//     stock cheap.
// So the anchor limits the buy upward and the sell downward - in both cases
// it only stops us from moving towards a worse deal. A wrong-low buy anchor
// costs missed purchases while the price catches up (a 3 -> 18 ref move
// takes about 8 days at 25% a day); a wrong-high sell anchor costs a few
// days of slow sales. Neither is ever reinforced, because the anchor never
// pushes a price the market does not support: the floor is never at or
// under the buy, and the sell-only, placeholder and locked-margin sells are
// left alone. That is the opposite of the old self-anchoring sell rule, which
// rejected every ask that disagreed with recent sells and kept The Birdcage
// at 40 ref for days.
//
// An implausible anchor is not a market and is skipped: a buy anchor under
// minBuyOfSellPct of the sell anchor came from a sell-only placeholder, not
// from bids. Hard Hearing had a 24 h anchor of buy 4.5 / sell 118.11, so the
// ramp held its buy at 5.61 for 27 hours against bids at 64-75 ref and the
// climb would have taken ~12 days. Without the ramp the bids stay bounded by
// the anchor ceiling (1.5x the SELL anchor), so the pump protection stays.
// Likewise there is no sell floor when the sell anchor is under the buy
// anchor.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: true,
  windowHours: 24,
  minRows: 8,
  maxBidAbovePct: 0.5,
  maxBidAboveMetal: 0.33,
  maxBuyRisePct: 0.25,
  maxBuyRiseMetal: 0.33,
  longWindowHours: 168,
  longMinRows: 96,
  minBuyOfSellPct: 0.5,
  maxSellDropPct: 0.25,
  maxSellDropMetal: 0.33,
};

function num(v, fallback) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

function options(opts) {
  const o = opts || {};
  const out = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    out[k] = k === 'enabled' ? o.enabled !== false : num(o[k], v);
  }
  return out;
}

// Same rounding as Methods.getRight: nearest weapon, written as 2 dp.
function toWeaponNotation(v) {
  const halfScraps = Math.round(v * 18);
  const scrap = halfScraps / 2;
  return Math.floor(Math.round((scrap / 9) * 10000) / 100) / 100;
}

// sku -> { buy, sell, n, longBuy, longSell, longN }: the median buy and sell
// over the last windowHours of price_history (null with fewer than minRows
// rows), and over the last longWindowHours (null with fewer than longMinRows
// rows). SKUs with neither are left out. Read once per cycle, before that
// cycle's rows are inserted, in one query: the short window is a FILTER on
// the long one's rows. Pricing uses buy / sell only; the long window is
// published for pricelist-ui (writeAnchorsFile).
async function loadAnchors(db, opts) {
  const o = options(opts);
  const anchors = new Map();
  if (!o.enabled) {
    return anchors;
  }
  const longHours = Math.max(o.longWindowHours, o.windowHours);
  const rows = await db.any(
    `SELECT sku,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY buy_metal)
              FILTER (WHERE timestamp > now() - ($1 * interval '1 hour')) AS buy,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_metal)
              FILTER (WHERE timestamp > now() - ($1 * interval '1 hour')) AS sell,
            (count(*) FILTER (WHERE timestamp > now() - ($1 * interval '1 hour')))::int AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY buy_metal) AS long_buy,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_metal) AS long_sell,
            count(*)::int AS long_n
       FROM price_history
      WHERE timestamp > now() - ($3 * interval '1 hour')
      GROUP BY sku
     HAVING count(*) FILTER (WHERE timestamp > now() - ($1 * interval '1 hour')) >= $2
         OR count(*) >= $4`,
    [o.windowHours, o.minRows, longHours, o.longMinRows]
  );
  const positive = (v) => {
    const n = Number(v);
    return v !== null && v !== undefined && n > 0 ? n : null;
  };
  for (const r of rows) {
    const n = Number(r.n) || 0;
    const longN = Number(r.long_n) || 0;
    const short = n >= o.minRows;
    const long = longN >= o.longMinRows;
    const entry = {
      buy: short ? positive(r.buy) : null,
      sell: short ? positive(r.sell) : null,
      n,
      longBuy: long ? positive(r.long_buy) : null,
      longSell: long ? positive(r.long_sell) : null,
      longN,
    };
    const hasShort = entry.buy !== null && entry.sell !== null;
    const hasLong = entry.longBuy !== null && entry.longSell !== null;
    if (!hasShort) {
      entry.buy = null;
      entry.sell = null;
    }
    if (!hasLong) {
      entry.longBuy = null;
      entry.longSell = null;
    }
    if (hasShort || hasLong) {
      anchors.set(r.sku, entry);
    }
  }
  return anchors;
}

// The anchor query reads price_history by SKU and time; without this index it
// scans the whole table. Called once at startup.
async function ensureIndex(db) {
  await db.none(
    'CREATE INDEX IF NOT EXISTS price_history_sku_ts_idx ON price_history (sku, timestamp)'
  );
}

// The highest bid that can still be for this item: the anchor's sell plus
// maxBidAbovePct, or plus maxBidAboveMetal on cheap items, whichever is
// larger. null without an anchor.
function anchorCeiling(anchor, opts) {
  if (!anchor || !(anchor.sell > 0)) {
    return null;
  }
  const o = options(opts);
  return Math.max(anchor.sell * (1 + o.maxBidAbovePct), anchor.sell + o.maxBidAboveMetal);
}

// The highest buy allowed this cycle: the anchor's buy plus maxBuyRisePct, or
// plus maxBuyRiseMetal on cheap items (one scrap is 11% of a 1 ref hat),
// whichever is larger, rounded DOWN to a whole weapon. Worked out in half
// scraps, so 0.77 ref (14 weapons) + 0.33 (6) is 1.11, not 1.10. null without
// an anchor, and null when the buy anchor is under minBuyOfSellPct of the
// sell anchor (a placeholder history, not a market - see the header).
function rampCap(anchor, opts) {
  if (!anchor || !(anchor.buy > 0)) {
    return null;
  }
  const o = options(opts);
  if (anchor.sell > 0 && anchor.buy < anchor.sell * o.minBuyOfSellPct) {
    return null;
  }
  const base = Math.round(anchor.buy * 18);
  const byPct = Math.floor(base * (1 + o.maxBuyRisePct) + 1e-9);
  const byMetal = base + Math.round(o.maxBuyRiseMetal * 18);
  return toWeaponNotation(Math.max(byPct, byMetal) / 18);
}

// One weapon (1/18 ref) above a price, in weapon notation.
const weaponAbove = (v) => toWeaponNotation((Math.round(v * 18) + 1) / 18);

// The lowest sell allowed this cycle: the anchor's sell minus maxSellDropPct,
// or minus maxSellDropMetal, whichever drop is larger (the mirror of rampCap:
// cheap items may move a few scrap), rounded UP to a whole weapon. null
// without an anchor sell, when the sell anchor is under the buy anchor (not a
// market), or when the floor would be at or under zero.
function sellFloor(anchor, opts) {
  if (!anchor || !(anchor.sell > 0)) {
    return null;
  }
  if (anchor.buy > 0 && anchor.sell < anchor.buy) {
    return null;
  }
  const o = options(opts);
  const base = Math.round(anchor.sell * 18);
  const byPct = Math.ceil(base * (1 - o.maxSellDropPct) - 1e-9);
  const byMetal = base - Math.round(o.maxSellDropMetal * 18);
  const floor = Math.min(byPct, byMetal);
  return floor > 0 ? toWeaponNotation(floor / 18) : null;
}

// Apply the sell floor: a sell under it is raised to it, but the result is
// at least one weapon over the buy (a floor under the buy would sell at a
// loss). -> { sell, floored }
function floorSell(sellMetal, buyMetal, floor) {
  if (floor === null || floor === undefined || !(sellMetal < floor - 0.005)) {
    return { sell: sellMetal, floored: false };
  }
  return { sell: Math.max(floor, weaponAbove(buyMetal)), floored: true };
}

// Publish the anchors for other local processes (pricelist-ui's inflow guard
// caps a bot's buy at the item's normal price when it suddenly accumulates
// it). Written atomically - a temp file renamed over the old one - so a
// reader never sees half a file. Every number is rounded to 2 dp; null stays
// null. meta: { windowHours, longWindowHours, keyMetal }.
function writeAnchorsFile(anchors, filePath, meta = {}) {
  const r2 = (v) =>
    v === null || v === undefined || !Number.isFinite(Number(v))
      ? null
      : Math.round(Number(v) * 100) / 100;
  const out = {};
  for (const [sku, a] of anchors || []) {
    out[sku] = {
      buy: r2(a.buy),
      sell: r2(a.sell),
      n: Number(a.n) || 0,
      longBuy: r2(a.longBuy),
      longSell: r2(a.longSell),
      longN: Number(a.longN) || 0,
    };
  }
  const doc = {
    updatedAt: new Date().toISOString(),
    windowHours: r2(meta.windowHours),
    longWindowHours: r2(meta.longWindowHours),
    keyMetal: r2(meta.keyMetal),
    anchors: out,
  };
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(doc));
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Already gone.
    }
    throw err;
  }
  return doc;
}

module.exports = {
  loadAnchors,
  writeAnchorsFile,
  ensureIndex,
  anchorCeiling,
  rampCap,
  sellFloor,
  floorSell,
  HISTORY_ANCHOR_DEFAULTS: DEFAULTS,
};
