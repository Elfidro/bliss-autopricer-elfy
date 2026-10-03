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
// What the anchor limits (see anchorCeiling / rampCap):
//   - bids far above our own recent sell price are not bids for this item
//     (or are bait), so they are dropped;
//   - the buy may rise at most maxBuyRisePct (or maxBuyRiseMetal) over the
//     window's median buy, so a creep takes days instead of hours.
// It only ever limits UPWARD buy moves and bids far above our recent sell. A
// wrong-low anchor costs missed purchases while the price catches up: at
// 25% per day a real 3 -> 18 ref move takes about 8 days. A wrong-high anchor
// is never reinforced, because nothing here raises a price. That is the
// opposite of the old self-anchoring sell rule, which rejected every ask that
// disagreed with recent sells and kept The Birdcage at 40 ref for days.

const DEFAULTS = {
  enabled: true,
  windowHours: 24,
  minRows: 8,
  maxBidAbovePct: 0.5,
  maxBidAboveMetal: 0.33,
  maxBuyRisePct: 0.25,
  maxBuyRiseMetal: 0.33,
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

// sku -> { buy, sell, n }: the median buy and sell over the last windowHours
// of price_history, for SKUs with at least minRows rows. Read once per cycle,
// before that cycle's rows are inserted (one query, ~135 ms on 583k rows).
async function loadAnchors(db, opts) {
  const o = options(opts);
  const anchors = new Map();
  if (!o.enabled) {
    return anchors;
  }
  const rows = await db.any(
    `SELECT sku,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY buy_metal) AS buy,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY sell_metal) AS sell,
            count(*)::int AS n
       FROM price_history
      WHERE timestamp > now() - ($1 * interval '1 hour')
      GROUP BY sku
     HAVING count(*) >= $2`,
    [o.windowHours, o.minRows]
  );
  for (const r of rows) {
    const buy = Number(r.buy);
    const sell = Number(r.sell);
    if (buy > 0 && sell > 0) {
      anchors.set(r.sku, { buy, sell, n: Number(r.n) });
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
// an anchor.
function rampCap(anchor, opts) {
  if (!anchor || !(anchor.buy > 0)) {
    return null;
  }
  const o = options(opts);
  const base = Math.round(anchor.buy * 18);
  const byPct = Math.floor(base * (1 + o.maxBuyRisePct) + 1e-9);
  const byMetal = base + Math.round(o.maxBuyRiseMetal * 18);
  return toWeaponNotation(Math.max(byPct, byMetal) / 18);
}

module.exports = {
  loadAnchors,
  ensureIndex,
  anchorCeiling,
  rampCap,
  HISTORY_ANCHOR_DEFAULTS: DEFAULTS,
};
