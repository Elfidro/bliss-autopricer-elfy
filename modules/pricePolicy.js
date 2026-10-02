// Stock-aware price adjustments and global price rules.
//
// The pricer computes the market price and keeps it in files/pricelist.json,
// where the dashboard, the price history and the accuracy scorer read it. A
// second process (pricelist-ui, which knows our marketplace.tf stock and each
// bot's inventory) decides when a bot should sell above or buy below that
// market price, and hands the decision over as files/price-policy.json:
//
//   {
//     "updatedAt": "2026-09-27T10:00:00.000Z",
//     "items": {
//       "5875;6;c108": { "sellAddMetal": 1, "buyDropMetal": 0.11, "note": "mptf 60/75" },
//       "30753;6":     { "buyCapMetal": 1.27, "sellFloorMetal": 0, "note": "craftHat buy ≤ 1.27" },
//       "30469;6":     { "buyAddWeapons": 1, "buyAddMinMetal": 1.22, "note": "Lia out of stock" },
//       "18000;6;c111": { "minSpreadMetal": 0.55, "note": "spread ≥ 0.55 ref" }
//     },
//     "global": {
//       "minSpreadMetal": 0.22,                          // sell - buy >= this; sell is raised
//       "gradeRules": [ { "grade": "Mercenary", "buyCapMetal": 0, "sellFloorMetal": 3.11 } ]
//     }
//   }
//
// Per SKU (pricelist-ui's group rules) and per grade (global) the same two
// knobs exist, a buy ceiling and a sell floor, applied by the same helpers.
//
// A SKU's own minSpreadMetal (pricelist-ui's per-item Min spread) replaces the
// global minimum spread for that item and is taken as set: the spread
// percentage cap does not apply to it, since it exists for items that need
// MORE room than the global rule gives them (keyless cases).
//
// Out of stock: pricelist-ui marks the SKUs a bot has none of with
// buyAddWeapons (whole weapons, 1 = half a scrap) and buyAddMinMetal. The buy
// goes up by that much when the MARKET buy is above buyAddMinMetal (checked
// against the market price, never the bumped one, so the rule cannot feed on
// itself). It is paid on purpose to keep the item in stock, so it is the very
// last step and nothing reacts to it: the sell, the spread, the caps and the
// floors are worked out as if it did not exist (a craft hat held at its 1.27
// cap still gets its half scrap on top). The one exception: a bump that would
// bring the buy up to the sell is skipped.
//
// The adjustments are applied only on the way OUT to the bots: on every
// socket emit and on the REST fetch tf2autobot does at startup. Nothing that
// is stored or scored changes. Order per item: the SKU's own sell add, the
// buy ceilings, the SKU's buy drop (off the capped buy), then the minimum spread (only ever raises the sell
// price, never lowers the buy), then the sell floors, and finally the
// out-of-stock buy bump on top of whatever buy those produced.
//
// tf2autobot drops a socket price update whose change rounds to 0 scrap on
// both sides, and Math.round(-0.5) is -0: a price that falls by exactly half
// a scrap (a bump coming off when the bot gets one back) would never land.
// bridgeFor() works out an intermediate price for the emit path to send
// first, from what was last sent for the SKU (see lastSentFor/recordSent).
//
// Grades come from the schema: items_game.item_collections lists every case
// cosmetic under its rarity (rare = Mercenary, mythical = Commando, ...). An
// item without a grade is never floored. Prices with keys are compared in
// metal at the current key price; if that is not known yet, the global rules
// skip key-priced items rather than guess.
//
// A stale policy (older than pricePolicy.maxAgeHours, default 2) is ignored so
// a dead pricelist-ui hands the bots plain market prices instead of freezing
// an old markup in place. When the file changes, the affected SKUs are
// re-emitted from the stored pricelist right away, so a withdrawal or a
// deposit shows up at the bot within the policy engine's cycle, not the
// pricer's. A change to the global rules re-emits everything.

const fs = require('fs');
const chokidar = require('chokidar');

const GRADE_BY_RARITY = {
  common: 'Civilian', uncommon: 'Freelance', rare: 'Mercenary',
  mythical: 'Commando', legendary: 'Assassin', ancient: 'Elite',
};

let policyPath = null;
let methods = null;
let pricerConfig = {};
let getSchema = () => null;
let getKeyMetal = () => null;
let maxAgeMs = 2 * 60 * 60 * 1000;
let state = { mtimeMs: -1, size: -1, updatedAt: 0, items: new Map(), global: null };
let loadErrorLogged = false;
let staleLogged = false;
let keyMetalWarned = false;
const lastEffects = new Map();      // sku -> what apply() did last, for the log line
let gradeCache = { ig: null, byName: null };

function init({ path: file, methods: m, config, getSchema: gs, getKeyMetal: gk }) {
  policyPath = file;
  methods = m;
  pricerConfig = config || {};
  if (typeof gs === 'function') getSchema = gs;
  if (typeof gk === 'function') getKeyMetal = gk;
  const hours = Number(config?.pricePolicy?.maxAgeHours);
  if (Number.isFinite(hours) && hours > 0) maxAgeMs = hours * 60 * 60 * 1000;
  load();
}

function round(v) {
  return methods ? methods.getRight(v) : Math.round(v * 100) / 100;
}

// One rule shape for grades and SKUs: an optional buy ceiling and sell floor.
function parseSides(r) {
  return {
    buyCapMetal: Math.max(0, Number(r && r.buyCapMetal) || 0),
    sellFloorMetal: Math.max(0, Number(r && r.sellFloorMetal) || 0),
  };
}

// Flat ref amounts do not scale: +1 ref on a 0.55 ref case triples it while
// +1 on a 13 ref case is a nudge. Every flat markup is therefore capped at a
// share of the item's market price: a sell add at maxSellAddPct of the market
// sell (default 20%), the minimum spread at minSpreadPct (default 10%). Above
// the crossover price (flat / pct) the flat amount applies unchanged, so cheap
// items get a proportional markup and dear ones exactly what was configured.
// The spread is worked in whole weapons (half scraps, the smallest price
// step) and rounds DOWN, so an item under 0.55 ref at 10% needs no spread at
// all instead of being pushed a whole scrap above the market.
const DEFAULT_MAX_SELL_ADD_PCT = 0.2;
const DEFAULT_MIN_SPREAD_PCT = 0.1;
const WEAPON = 1 / 18;
const toWeapons = (metal) => Math.round(metal * 18);

function pctOrDefault(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : dflt;
}

function parseGlobal(g) {
  if (!g || typeof g !== 'object') return null;
  const minSpreadMetal = Math.max(0, Number(g.minSpreadMetal) || 0);
  const maxSellAddPct = pctOrDefault(g.maxSellAddPct, DEFAULT_MAX_SELL_ADD_PCT);
  const minSpreadPct = pctOrDefault(g.minSpreadPct, DEFAULT_MIN_SPREAD_PCT);
  const byGrade = new Map();
  const add = (grade, sides) => {
    const name = String(grade || '').trim();
    if (!name || (!sides.buyCapMetal && !sides.sellFloorMetal)) return;
    const cur = byGrade.get(name.toLowerCase()) || { grade: name, buyCapMetal: 0, sellFloorMetal: 0 };
    if (sides.buyCapMetal) cur.buyCapMetal = cur.buyCapMetal ? Math.min(cur.buyCapMetal, sides.buyCapMetal) : sides.buyCapMetal;
    if (sides.sellFloorMetal) cur.sellFloorMetal = Math.max(cur.sellFloorMetal, sides.sellFloorMetal);
    byGrade.set(name.toLowerCase(), cur);
  };
  for (const r of Array.isArray(g.gradeRules) ? g.gradeRules : []) add(r && r.grade, parseSides(r));
  for (const f of Array.isArray(g.sellFloors) ? g.sellFloors : []) add(f && f.grade, { buyCapMetal: 0, sellFloorMetal: Number(f && f.metal) || 0 });   // older file format
  const gradeRules = [...byGrade.values()];
  return minSpreadMetal > 0 || gradeRules.length
    ? { minSpreadMetal, gradeRules, maxSellAddPct, minSpreadPct }
    : null;
}

// The largest sell add allowed on an item whose market sell is sellMetal.
function cappedSellAdd(add, sellMetal, pct) {
  if (!(add > 0)) return 0;
  if (!(sellMetal > 0)) return add;
  return Math.min(add, sellMetal * pct);
}

// The spread to enforce on an item whose market sell is sellMetal, in whole
// weapons: the share of the sell price rounded down, capped at the flat
// spread. Zero means the rule is skipped for this item.
function cappedSpreadWeapons(spread, sellMetal, pct) {
  if (!(spread > 0)) return 0;
  const flat = toWeapons(spread);
  if (!(sellMetal > 0)) return flat;
  return Math.min(flat, Math.floor(sellMetal * pct * 18 + 1e-6));
}

function hasPolicy() {
  return state.items.size > 0 || !!state.global;
}

// Re-read the file when its mtime/size moved. Errors keep the last good policy.
function load() {
  if (!policyPath) return state;
  let stats;
  try {
    stats = fs.statSync(policyPath);
  } catch {
    if (hasPolicy()) {
      console.warn('[POLICY] price-policy.json disappeared; adjustments cleared');
      state = { mtimeMs: -1, size: -1, updatedAt: 0, items: new Map(), global: null };
      lastEffects.clear();
    }
    return state;
  }
  if (stats.mtimeMs === state.mtimeMs && stats.size === state.size) return state;
  try {
    const parsed = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    const items = new Map();
    for (const [sku, adj] of Object.entries(parsed.items || {})) {
      const sellAdd = Number(adj.sellAddMetal) || 0;
      const buyDrop = Number(adj.buyDropMetal) || 0;
      const sides = parseSides(adj);
      const buyAddWeapons = Math.max(0, Math.round(Number(adj.buyAddWeapons) || 0));
      const buyAddMinMetal = Math.max(0, Number(adj.buyAddMinMetal) || 0);
      const minSpreadMetal = Math.max(0, Number(adj.minSpreadMetal) || 0);
      if (sellAdd === 0 && buyDrop === 0 && !sides.buyCapMetal && !sides.sellFloorMetal && !buyAddWeapons && !minSpreadMetal) {
        continue;
      }
      items.set(sku, {
        sellAddMetal: sellAdd,
        buyDropMetal: buyDrop,
        ...sides,
        buyAddWeapons,
        buyAddMinMetal,
        minSpreadMetal,
        note: adj.note || '',
      });
    }
    state = {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      updatedAt: Date.parse(parsed.updatedAt) || stats.mtimeMs,
      items,
      global: parseGlobal(parsed.global),
    };
    lastEffects.clear();
    loadErrorLogged = false;
    staleLogged = false;
  } catch (err) {
    if (!loadErrorLogged) {
      console.error(`[POLICY] could not read ${policyPath}: ${err.message} (keeping last policy)`);
      loadErrorLogged = true;
    }
  }
  return state;
}

function isFresh() {
  const fresh = Date.now() - state.updatedAt <= maxAgeMs;
  if (!fresh && hasPolicy() && !staleLogged) {
    console.warn(`[POLICY] price-policy.json is older than ${maxAgeMs / 3600000}h; ignoring adjustments until it is rewritten`);
    staleLogged = true;
  }
  return fresh;
}

function adjustmentFor(sku) {
  load();
  if (!state.items.size || !isFresh()) return null;
  return state.items.get(sku) || null;
}

// Grade of a SKU from the schema's item collections. The collections list
// items by their items_game name ("The Aimframe"), so the SKU's defindex is
// looked up there first; the display name (with or without "The ") is the
// fallback. The name map is rebuilt whenever the schema object changes.
function gradeOf(sku, name) {
  let schema;
  try { schema = getSchema(); } catch { schema = null; }
  const ig = schema && schema.raw && schema.raw.items_game;
  if (!ig) return null;
  if (gradeCache.ig !== ig) {
    const byName = new Map();
    for (const col of Object.values(ig.item_collections || {})) {
      for (const [rarity, items] of Object.entries(col.items || {})) {
        const grade = GRADE_BY_RARITY[rarity];
        if (!grade || !items || typeof items !== 'object') continue;
        for (const n of Object.keys(items)) byName.set(n.toLowerCase(), grade);
      }
    }
    gradeCache = { ig, byName };
  }
  const def = ig.items && ig.items[String(sku).split(';')[0]];
  const igName = def && def.name ? String(def.name).toLowerCase() : null;
  if (igName && gradeCache.byName.has(igName)) return gradeCache.byName.get(igName);
  if (name) {
    const n = String(name).toLowerCase();
    return gradeCache.byName.get(n) || gradeCache.byName.get(`the ${n}`) || null;
  }
  return null;
}

// ── Shared price helpers ──────────────────────────────────────────────────
// The same three moves serve the per-SKU group rules and the global grade
// rules: cap the buy, floor the sell, keep the spread. Prices with keys are
// worked in metal at the current key price and skipped until it is known.
function keyMetalNow() { return Number(getKeyMetal()) || 0; }
function usesKeys(p) { return (p.keys || 0) > 0; }
function priceToMetal(p, keyMetal) { return (p.keys || 0) * keyMetal + (p.metal || 0); }
function warnKeyMetal() {
  if (keyMetalWarned) return;
  console.warn('[POLICY] key price not known yet; rules skip key-priced items until it is');
  keyMetalWarned = true;
}
// Split a metal total into whole keys (when the key price is known) + metal.
function splitKeys(total, keyMetal) {
  const keys = keyMetal > 0 && total >= keyMetal ? Math.floor(total / keyMetal) : 0;
  return { keys, rest: Math.max(0, total - keys * keyMetal) };
}

// Buy price ceiling: never above cap. Rounded DOWN to a whole scrap so the
// result never exceeds the cap (1.27 -> 1.22).
function capBuy(out, cap, effects, why) {
  const keyMetal = keyMetalNow();
  if (usesKeys(out.buy) && !(keyMetal > 0)) return warnKeyMetal();
  if (priceToMetal(out.buy, keyMetal) <= cap + 0.005) return;
  const { keys, rest } = splitKeys(cap, keyMetal);
  out.buy.keys = keys;
  out.buy.metal = round(Math.floor(rest / 0.11 + 1e-6) * 0.11);
  effects.push(`${why} buy capped at ${cap} ref`);
}

// Sell price floor: never below floor (only ever raises the sell price).
function floorSell(out, floor, effects, why) {
  const keyMetal = keyMetalNow();
  if (usesKeys(out.sell) && !(keyMetal > 0)) return warnKeyMetal();
  if (priceToMetal(out.sell, keyMetal) >= floor - 0.005) return;
  const { keys, rest } = splitKeys(floor, keyMetal);
  out.sell.keys = keys;
  out.sell.metal = round(rest);
  effects.push(`${why} sell floor ${floor} ref`);
}

// Minimum spread (in weapons): the sell price is raised to buy + spread; the
// buy price is never lowered for this. A market spread that already covers
// the requirement is left exactly as it is.
function keepSpread(out, weapons, effects, why = '') {
  if (!(weapons > 0)) return;
  const keyMetal = keyMetalNow();
  if ((usesKeys(out.buy) || usesKeys(out.sell)) && !(keyMetal > 0)) return warnKeyMetal();
  const buyM = priceToMetal(out.buy, keyMetal);
  if (toWeapons(priceToMetal(out.sell, keyMetal) - buyM) >= weapons) return;
  const spread = weapons * WEAPON;
  const { keys, rest } = splitKeys(buyM + spread, keyMetal);
  out.sell.keys = keys;
  out.sell.metal = round(rest);
  effects.push(`sell raised to buy + ${round(spread)} ref${why ? ` (${why})` : ''}`);
}

// a < b, in metal when the key price is known, else keys first, then metal
// (normalised prices keep the metal under a key).
function priceBelow(a, b, keyMetal) {
  if (keyMetal > 0) return priceToMetal(a, keyMetal) < priceToMetal(b, keyMetal) - 0.005;
  if ((a.keys || 0) !== (b.keys || 0)) return (a.keys || 0) < (b.keys || 0);
  return (a.metal || 0) < (b.metal || 0) - 0.005;
}

// Out-of-stock buy bump, the last step: adj.buyAddWeapons whole weapons on
// top of the buy the other rules produced, when the item's MARKET buy is above
// adj.buyAddMinMetal. A key-priced buy with the key price not known yet counts
// as above (a key is far over it). Skipped only when it would meet the sell.
function bumpBuy(out, item, adj, effects) {
  const keyMetal = keyMetalNow();
  const known = keyMetal > 0;
  const marketBuy = usesKeys(item.buy) && !known ? Infinity : priceToMetal(item.buy, keyMetal);
  if (!(marketBuy > adj.buyAddMinMetal + 0.005)) return;
  const bumped = {
    ...out.buy,
    keys: out.buy.keys || 0,
    metal: round((out.buy.metal || 0) + adj.buyAddWeapons * WEAPON),
  };
  // Nothing runs after this to raise the sell, so never buy at the sell.
  if (!priceBelow(bumped, out.sell, keyMetal)) {
    effects.push('buy bump skipped: would meet the sell');
    return;
  }
  out.buy = bumped;
  effects.push(`buy +${adj.buyAddWeapons / 2} scrap (out of stock)`);
}

// Returns the item as the bots should see it. Untouched items come back as-is.
// Order: the SKU's stock adjustments, buy ceilings (group, then grade), the
// spread (the SKU's own, else the global one), sell floors (group, then grade), then the out-of-stock buy bump,
// which nothing before it takes into account.
// What the bots see for the key. tf2autobot values keys a buyer pays with at
// the key BUY price, and keys it hands out at the key SELL price, so a buy
// price keyPricing.botBuyDiscountMetal under the market is a fee on paying in
// keys: a key covers that much less of a metal-priced item. No other rule
// touches the key - a spread or floor applied to it re-expresses its own
// price in keys (64.66 ref once became 1 key + 0.11). The stored price, the
// dashboard and /items/5021;6?market=1 stay at market.
function applyKey(item) {
  const discount = Number(pricerConfig.keyPricing && pricerConfig.keyPricing.botBuyDiscountMetal) || 0;
  if (!(discount > 0) || (item.buy.keys || 0) > 0 || (item.sell.keys || 0) > 0) return item;
  const buy = round((item.buy.metal || 0) - discount);
  if (!(buy > 0) || buy >= (item.sell.metal || 0)) return item;
  const out = { ...item, buy: { keys: 0, metal: buy }, sell: { ...item.sell } };
  lastEffects.set(item.sku, `key buy ${discount} ref under market (fee on paying in keys)`);
  return out;
}

function apply(item) {
  if (!item || !item.sku || !item.buy || !item.sell) return item;
  if (item.sku === '5021;6') return applyKey(item);
  load();
  if (!hasPolicy() || !isFresh()) return item;
  const adj = state.items.get(item.sku) || null;
  const g = state.global;
  if (!adj && !g) return item;
  const out = { ...item, buy: { ...item.buy }, sell: { ...item.sell } };
  const effects = [];
  // Market sell in metal, the base every percentage cap is taken against.
  const marketSellMetal = priceToMetal(item.sell, keyMetalNow());
  const addPct = g ? g.maxSellAddPct : DEFAULT_MAX_SELL_ADD_PCT;
  const spreadPct = g ? g.minSpreadPct : DEFAULT_MIN_SPREAD_PCT;
  if (adj) {
    if (adj.sellAddMetal) {
      const add = cappedSellAdd(adj.sellAddMetal, marketSellMetal, addPct);
      out.sell.metal = round((out.sell.metal || 0) + add);
      if (add < adj.sellAddMetal - 0.005) {
        effects.push(`sell add capped at ${Math.round(addPct * 100)}% (${round(add)} ref)`);
      }
    }
    if (adj.sellAddMetal || adj.buyDropMetal) effects.push(describeAdjustment({ sellAddMetal: adj.sellAddMetal, buyDropMetal: adj.buyDropMetal, note: adj.note }));
  }
  const grade = g && g.gradeRules.length ? gradeOf(item.sku, item.name) : null;
  const gr = grade ? g.gradeRules.find((r) => r.grade.toLowerCase() === grade.toLowerCase()) : null;
  if (adj && adj.buyCapMetal) capBuy(out, adj.buyCapMetal, effects, 'group');
  if (gr && gr.buyCapMetal) capBuy(out, gr.buyCapMetal, effects, grade);
  // The stock drop comes off the CAPPED buy, so a drop on a craft hat whose
  // market buy sits above the season cap is not erased by the cap (market
  // 1.55, cap 1.33, drop 0.22 -> 1.11, not 1.33). Key-priced buys are left
  // alone until the key price is known, like the other rules.
  if (adj && adj.buyDropMetal) {
    const keyMetal = keyMetalNow();
    if (usesKeys(out.buy) && !(keyMetal > 0)) warnKeyMetal();
    else {
      const dropped = Math.max(0, priceToMetal(out.buy, keyMetal) - adj.buyDropMetal);
      const { keys, rest } = splitKeys(dropped, keyMetal);
      out.buy.keys = keys;
      out.buy.metal = round(rest);
    }
  }
  // The SKU's own spread wins over the global one and is not capped. It is
  // taken to the nearest weapon: ref values are truncated decimals (0.55 ref
  // is 5 scrap = 10 weapons, 9.9 by plain arithmetic).
  if (adj && adj.minSpreadMetal > 0) keepSpread(out, toWeapons(adj.minSpreadMetal), effects, 'item spread');
  else if (g && g.minSpreadMetal > 0) keepSpread(out, cappedSpreadWeapons(g.minSpreadMetal, marketSellMetal, spreadPct), effects);
  if (adj && adj.sellFloorMetal) floorSell(out, adj.sellFloorMetal, effects, 'group');
  if (gr && gr.sellFloorMetal) floorSell(out, gr.sellFloorMetal, effects, grade);
  if (adj && adj.buyAddWeapons > 0) bumpBuy(out, item, adj, effects);
  if (!effects.length) return item;
  lastEffects.set(item.sku, effects.join(', '));
  // tf2autobot only takes a price it considers newer, so an adjusted price
  // must carry at least the policy's own timestamp.
  const policySec = Math.floor(state.updatedAt / 1000);
  if (!out.time || out.time < policySec) out.time = policySec;
  return out;
}

// ── Half-scrap decrease bridge ────────────────────────────────────────────
// tf2autobot 5.18 (Pricelist.handlePriceChange) ignores a socket price update
// when Math.round(new - old), in scrap, is 0 on both sides. Math.round(-0.5)
// is -0 while Math.round(0.5) is 1, so a rise of half a scrap lands but a fall
// of exactly half a scrap (with the other side still or also falling by half)
// is dropped and the bot keeps the old price. There is no time check on that
// path, so a bridge carries the same time as the real price.
const lastSent = new Map(); // sku -> { buy, sell } as last handed to the emit queue

function lastSentFor(sku) {
  return lastSent.get(sku) || null;
}

function recordSent(item) {
  if (!item || !item.sku || !item.buy || !item.sell) return;
  lastSent.set(item.sku, { buy: { ...item.buy }, sell: { ...item.sell } });
}

// A price worth `weapons` weapons in total, keeping p's key count where it can.
function withWeapons(p, weapons, keyMetal) {
  const total = weapons * WEAPON;
  const keys = p.keys || 0;
  if (total - keys * keyMetal >= -1e-9) return { ...p, keys, metal: round(total - keys * keyMetal) };
  const split = splitKeys(total, keyMetal);
  return { ...p, keys: split.keys, metal: round(split.rest) };
}

// The intermediate price to send before `next` so the bot, holding `prev`,
// takes both steps; null when `next` lands on its own, nothing was sent
// before, or keys are involved and the key price is not known.
// The bridge only ever makes the deal worse for the trader: a buy that falls
// by half a scrap is sent one weapon lower first (-1 scrap, then +0.5); a sell
// that falls on its own is sent one weapon ABOVE the old sell first (+0.5,
// then -1), so the bridge never undersells or brings the sell down to the buy.
function bridgeFor(prev, next, keyMetal = keyMetalNow()) {
  if (!prev || !next || !prev.buy || !prev.sell || !next.buy || !next.sell) return null;
  if (next.sku === '5021;6') return null;
  const km = Number(keyMetal) || 0;
  if ([prev.buy, prev.sell, next.buy, next.sell].some(usesKeys) && !(km > 0)) return null;
  const w = (p) => toWeapons(priceToMetal(p, km));
  const nextBuyW = w(next.buy);
  const nextSellW = w(next.sell);
  const dBuyW = nextBuyW - w(prev.buy);
  const dSellW = nextSellW - w(prev.sell);
  if (Math.round(dBuyW / 2) !== 0 || Math.round(dSellW / 2) !== 0) return null; // lands as it is
  if (dBuyW === 0 && dSellW === 0) return null; // nothing moved
  const bridge = { ...next, buy: { ...next.buy }, sell: { ...next.sell } };
  if (dBuyW < 0 && nextBuyW >= 1) bridge.buy = withWeapons(next.buy, nextBuyW - 1, km);
  else bridge.sell = withWeapons(next.sell, nextSellW + 2, km);
  return bridge;
}

function fmtPrice(p) {
  return p.keys ? `${p.keys}k ${p.metal}` : `${p.metal}`;
}

// "buy 1.38 → 1.27 → 1.33" for the log line.
function describeBridge(prev, bridge, next) {
  const side = fmtPrice(bridge.buy) !== fmtPrice(next.buy) ? 'buy' : 'sell';
  return `${side} ${fmtPrice(prev[side])} → ${fmtPrice(bridge[side])} → ${fmtPrice(next[side])}`;
}

function applyAll(items) {
  if (!Array.isArray(items)) return items;
  load();
  if (!hasPolicy() || !isFresh()) return items;
  return items.map(apply);
}

function hasAdjustments() {
  load();
  return hasPolicy() && isFresh();
}

function describeAdjustment(adj) {
  const parts = [];
  if (adj.sellAddMetal) parts.push(`sell +${adj.sellAddMetal} ref`);
  if (adj.buyDropMetal) parts.push(`buy -${adj.buyDropMetal} ref`);
  if (adj.buyCapMetal) parts.push(`buy ≤ ${adj.buyCapMetal} ref`);
  if (adj.sellFloorMetal) parts.push(`sell ≥ ${adj.sellFloorMetal} ref`);
  if (adj.buyAddWeapons) parts.push(`buy +${adj.buyAddWeapons / 2} scrap when > ${adj.buyAddMinMetal} ref`);
  if (adj.minSpreadMetal) parts.push(`spread ≥ ${adj.minSpreadMetal} ref`);
  return parts.join(', ') + (adj.note ? ` (${adj.note})` : '');
}

// What the last apply() did to this SKU (per-SKU adjustment and global rules).
function describe(sku) {
  if (lastEffects.has(sku)) return lastEffects.get(sku);
  const adj = adjustmentFor(sku);
  return adj ? describeAdjustment(adj) : '';
}

// Calls onChange(skus) with every SKU whose adjustment differs from before,
// including SKUs that dropped out of the policy (they go back to market), or
// onChange(null) when the global rules changed, which means every item.
function watch(onChange) {
  if (!policyPath) return;
  let previous = new Map(state.items);
  let previousGlobal = JSON.stringify(state.global);
  const diff = () => {
    load();
    const globalNow = JSON.stringify(state.global);
    const globalChanged = globalNow !== previousGlobal;
    const changed = [];
    const keys = new Set([...previous.keys(), ...state.items.keys()]);
    for (const sku of keys) {
      const a = previous.get(sku);
      const b = state.items.get(sku);
      const moved =
        a &&
        b &&
        (a.sellAddMetal !== b.sellAddMetal ||
          a.buyDropMetal !== b.buyDropMetal ||
          a.buyCapMetal !== b.buyCapMetal ||
          a.sellFloorMetal !== b.sellFloorMetal ||
          a.buyAddWeapons !== b.buyAddWeapons ||
          a.buyAddMinMetal !== b.buyAddMinMetal ||
          a.minSpreadMetal !== b.minSpreadMetal);
      if (!a !== !b || moved) {
        changed.push(sku);
      }
    }
    previous = new Map(state.items);
    previousGlobal = globalNow;
    if (globalChanged) onChange(null);
    else if (changed.length) onChange(changed);
  };
  const watcher = chokidar.watch(policyPath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300 } });
  watcher.on('add', diff);
  watcher.on('change', diff);
  watcher.on('unlink', diff);
}

function getState() {
  load();
  return {
    path: policyPath,
    updatedAt: state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
    fresh: isFresh(),
    items: Object.fromEntries(state.items),
    global: state.global,
  };
}

module.exports = {
  init,
  apply,
  applyAll,
  hasAdjustments,
  describe,
  watch,
  getState,
  gradeOf,
  bridgeFor,
  describeBridge,
  lastSentFor,
  recordSent,
};
