// Stock-aware price adjustments.
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
//     }
//   }
//
// The adjustments are applied only on the way OUT to the bots: on every
// socket emit and on the REST fetch tf2autobot does at startup. Nothing that
// is stored or scored changes.
//
// A stale policy (older than pricePolicy.maxAgeHours, default 2) is ignored so
// a dead pricelist-ui hands the bots plain market prices instead of freezing
// an old markup in place. When the file changes, the affected SKUs are
// re-emitted from the stored pricelist right away, so a withdrawal or a
// deposit shows up at the bot within the policy engine's cycle, not the
// pricer's.

const fs = require('fs');
const chokidar = require('chokidar');

let policyPath = null;
let methods = null;
let maxAgeMs = 2 * 60 * 60 * 1000;
let state = { mtimeMs: -1, size: -1, updatedAt: 0, items: new Map() };
let loadErrorLogged = false;
let staleLogged = false;

function init({ path: file, methods: m, config }) {
  policyPath = file;
  methods = m;
  const hours = Number(config?.pricePolicy?.maxAgeHours);
  if (Number.isFinite(hours) && hours > 0) maxAgeMs = hours * 60 * 60 * 1000;
  load();
}

function round(v) {
  return methods ? methods.getRight(v) : Math.round(v * 100) / 100;
}

// Re-read the file when its mtime/size moved. Errors keep the last good policy.
function load() {
  if (!policyPath) return state;
  let stats;
  try {
    stats = fs.statSync(policyPath);
  } catch {
    if (state.items.size) {
      console.warn('[POLICY] price-policy.json disappeared; adjustments cleared');
      state = { mtimeMs: -1, size: -1, updatedAt: 0, items: new Map() };
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
    };
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
  if (!fresh && state.items.size && !staleLogged) {
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

// Returns the item as the bots should see it. Untouched items come back as-is.
function apply(item) {
  if (!item || !item.sku || !item.buy || !item.sell) return item;
  const adj = adjustmentFor(item.sku);
  if (!adj) return item;
  const out = { ...item, buy: { ...item.buy }, sell: { ...item.sell } };
  if (adj.sellAddMetal) out.sell.metal = round((out.sell.metal || 0) + adj.sellAddMetal);
  if (adj.buyDropMetal) out.buy.metal = Math.max(0, round((out.buy.metal || 0) - adj.buyDropMetal));
  // tf2autobot only takes a price it considers newer, so an adjusted price
  // must carry at least the policy's own timestamp.
  const policySec = Math.floor(state.updatedAt / 1000);
  if (!out.time || out.time < policySec) out.time = policySec;
  return out;
}

function applyAll(items) {
  if (!Array.isArray(items)) return items;
  load();
  if (!state.items.size || !isFresh()) return items;
  return items.map(apply);
}

function hasAdjustments() {
  load();
  return state.items.size > 0 && isFresh();
}

function describe(sku) {
  const adj = adjustmentFor(sku);
  if (!adj) return '';
  const parts = [];
  if (adj.sellAddMetal) parts.push(`sell +${adj.sellAddMetal} ref`);
  if (adj.buyDropMetal) parts.push(`buy -${adj.buyDropMetal} ref`);
  return parts.join(', ') + (adj.note ? ` (${adj.note})` : '');
}

// Calls onChange(skus) with every SKU whose adjustment differs from before,
// including SKUs that dropped out of the policy (they go back to market).
function watch(onChange) {
  if (!policyPath) return;
  let previous = new Map(state.items);
  const diff = () => {
    load();
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
    if (changed.length) onChange(changed);
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
  };
}

module.exports = { init, apply, applyAll, hasAdjustments, describe, watch, getState };
