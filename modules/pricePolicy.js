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
//       "30753;6":     { "buyCapMetal": 1.27, "sellFloorMetal": 0, "note": "craftHat buy ≤ 1.27" }
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
// The adjustments are applied only on the way OUT to the bots: on every
// socket emit and on the REST fetch tf2autobot does at startup. Nothing that
// is stored or scored changes. Order per item: the SKU's own sell add / buy
// drop, then the minimum spread (only ever raises the sell price, never
// lowers the buy), then the grade sell floor, so the floor is the last word.
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
// sell (default 20%), the minimum spread at minSpreadPct (default 10%, never
// under one weapon). Above the crossover price (flat / pct) the flat amount
// applies unchanged, so cheap items get a proportional markup and dear ones
// exactly what was configured.
const DEFAULT_MAX_SELL_ADD_PCT = 0.2;
const DEFAULT_MIN_SPREAD_PCT = 0.1;
const WEAPON = 0.05;

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

// The spread to enforce on an item whose market sell is sellMetal.
function cappedSpread(spread, sellMetal, pct) {
  if (!(spread > 0)) return 0;
  if (!(sellMetal > 0)) return spread;
  return Math.max(WEAPON, Math.min(spread, sellMetal * pct));
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
      if (sellAdd === 0 && buyDrop === 0 && !sides.buyCapMetal && !sides.sellFloorMetal) continue;
      items.set(sku, { sellAddMetal: sellAdd, buyDropMetal: buyDrop, ...sides, note: adj.note || '' });
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

// Minimum spread: the sell price is raised to buy + spread; the buy price is
// never lowered for this.
function keepSpread(out, spread, effects) {
  const keyMetal = keyMetalNow();
  if ((usesKeys(out.buy) || usesKeys(out.sell)) && !(keyMetal > 0)) return warnKeyMetal();
  const buyM = priceToMetal(out.buy, keyMetal);
  if (priceToMetal(out.sell, keyMetal) - buyM >= spread - 0.005) return;
  const { keys, rest } = splitKeys(buyM + spread, keyMetal);
  out.sell.keys = keys;
  out.sell.metal = round(rest);
  effects.push(`sell raised to buy + ${spread} ref`);
}

// Returns the item as the bots should see it. Untouched items come back as-is.
// Order: the SKU's stock adjustments, buy ceilings (group, then grade), the
// spread, then sell floors (group, then grade) as the last word.
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
    if (adj.buyDropMetal) out.buy.metal = Math.max(0, round((out.buy.metal || 0) - adj.buyDropMetal));
    if (adj.sellAddMetal || adj.buyDropMetal) effects.push(describeAdjustment({ sellAddMetal: adj.sellAddMetal, buyDropMetal: adj.buyDropMetal, note: adj.note }));
  }
  const grade = g && g.gradeRules.length ? gradeOf(item.sku, item.name) : null;
  const gr = grade ? g.gradeRules.find((r) => r.grade.toLowerCase() === grade.toLowerCase()) : null;
  if (adj && adj.buyCapMetal) capBuy(out, adj.buyCapMetal, effects, 'group');
  if (gr && gr.buyCapMetal) capBuy(out, gr.buyCapMetal, effects, grade);
  if (g && g.minSpreadMetal > 0) keepSpread(out, cappedSpread(g.minSpreadMetal, marketSellMetal, spreadPct), effects);
  if (adj && adj.sellFloorMetal) floorSell(out, adj.sellFloorMetal, effects, 'group');
  if (gr && gr.sellFloorMetal) floorSell(out, gr.sellFloorMetal, effects, grade);
  if (!effects.length) return item;
  lastEffects.set(item.sku, effects.join(', '));
  // tf2autobot only takes a price it considers newer, so an adjusted price
  // must carry at least the policy's own timestamp.
  const policySec = Math.floor(state.updatedAt / 1000);
  if (!out.time || out.time < policySec) out.time = policySec;
  return out;
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
      if (!a !== !b || (a && b && (a.sellAddMetal !== b.sellAddMetal || a.buyDropMetal !== b.buyDropMetal || a.buyCapMetal !== b.buyCapMetal || a.sellFloorMetal !== b.sellFloorMetal))) {
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

module.exports = { init, apply, applyAll, hasAdjustments, describe, watch, getState, gradeOf };
