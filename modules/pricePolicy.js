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
//       "5875;6;c108": { "sellAddMetal": 1, "buyDropMetal": 0.11, "note": "mptf 60/75" }
//     },
//     "global": {
//       "minSpreadMetal": 0.22,                          // sell - buy >= this; sell is raised
//       "sellFloors": [ { "grade": "Mercenary", "metal": 3.11 } ]   // sell >= this per item grade
//     }
//   }
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
  if (typeof gs === 'function') getSchema = gs;
  if (typeof gk === 'function') getKeyMetal = gk;
  const hours = Number(config?.pricePolicy?.maxAgeHours);
  if (Number.isFinite(hours) && hours > 0) maxAgeMs = hours * 60 * 60 * 1000;
  load();
}

function round(v) {
  return methods ? methods.getRight(v) : Math.round(v * 100) / 100;
}

function parseGlobal(g) {
  if (!g || typeof g !== 'object') return null;
  const minSpreadMetal = Math.max(0, Number(g.minSpreadMetal) || 0);
  const sellFloors = (Array.isArray(g.sellFloors) ? g.sellFloors : [])
    .map((f) => ({ grade: String((f && f.grade) || '').trim(), metal: Number(f && f.metal) || 0 }))
    .filter((f) => f.grade && f.metal > 0);
  return minSpreadMetal > 0 || sellFloors.length ? { minSpreadMetal, sellFloors } : null;
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
      if (sellAdd === 0 && buyDrop === 0) continue;
      items.set(sku, { sellAddMetal: sellAdd, buyDropMetal: buyDrop, note: adj.note || '' });
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

// Global rules on one item. Only the sell side ever moves, and only upward.
function applyGlobal(out, item, g, effects) {
  const keyMetal = Number(getKeyMetal()) || 0;
  const usesKeys = (out.buy.keys || 0) > 0 || (out.sell.keys || 0) > 0;
  if (usesKeys && !(keyMetal > 0)) {
    if (!keyMetalWarned) {
      console.warn('[POLICY] key price not known yet; global rules skip key-priced items until it is');
      keyMetalWarned = true;
    }
    return;
  }
  const toMetal = (p) => (p.keys || 0) * keyMetal + (p.metal || 0);
  const setSell = (total) => {
    let metal = total - (out.sell.keys || 0) * keyMetal;
    if (keyMetal > 0 && metal >= keyMetal) {          // carry whole keys
      out.sell.keys = (out.sell.keys || 0) + Math.floor(metal / keyMetal);
      metal %= keyMetal;
    }
    out.sell.metal = round(Math.max(0, metal));
  };
  if (g.minSpreadMetal > 0) {
    const buyM = toMetal(out.buy);
    if (toMetal(out.sell) - buyM < g.minSpreadMetal - 0.005) {
      setSell(buyM + g.minSpreadMetal);
      effects.push(`sell raised to buy + ${g.minSpreadMetal} ref`);
    }
  }
  if (g.sellFloors.length) {
    const grade = gradeOf(item.sku, item.name);
    const floor = grade && g.sellFloors.find((f) => f.grade.toLowerCase() === grade.toLowerCase());
    if (floor && toMetal(out.sell) < floor.metal - 0.005) {
      setSell(floor.metal);
      effects.push(`${grade} sell floor ${floor.metal} ref`);
    }
  }
}

// Returns the item as the bots should see it. Untouched items come back as-is.
function apply(item) {
  if (!item || !item.sku || !item.buy || !item.sell) return item;
  load();
  if (!hasPolicy() || !isFresh()) return item;
  const adj = state.items.get(item.sku) || null;
  const g = state.global;
  if (!adj && !g) return item;
  const out = { ...item, buy: { ...item.buy }, sell: { ...item.sell } };
  const effects = [];
  if (adj) {
    if (adj.sellAddMetal) out.sell.metal = round((out.sell.metal || 0) + adj.sellAddMetal);
    if (adj.buyDropMetal) out.buy.metal = Math.max(0, round((out.buy.metal || 0) - adj.buyDropMetal));
    effects.push(describeAdjustment(adj));
  }
  if (g) applyGlobal(out, item, g, effects);
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
      if (!a !== !b || (a && b && (a.sellAddMetal !== b.sellAddMetal || a.buyDropMetal !== b.buyDropMetal))) {
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
