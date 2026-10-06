// Drop pricelist entries nobody prices any more.
//
// The pricer only ever rewrites entries for the items it priced, so anything
// else in files/pricelist.json stays there for good and keeps being served
// (GET /items, the policy re-emit). On Oct 4 the droplet's pricelist carried
// 51 "Strange ..." entries removed from item_list.json 58 hours earlier, and
// two entries under SKUs from before the name-parse fix (6d99854): "Frostbite
// Fit" as null;5;u87 and "Haunted Hoard Case #153" as null;13, each next to
// its correct current entry.
//
// An entry is stale (the key, 5021;6, never is) when
//   - its name is not in the item list (`allowed`; pass null to skip this
//     rule, e.g. when every item is priced), or
//   - its sku contains "null" (a name that did not resolve), or
//   - its name now resolves to a different sku and an entry under that sku
//     exists (the old entry is a leftover of a parse fix).
//
// Pure: resolveSku(name) -> sku or null is passed in.
//   -> { items, notAllowed, brokenSku }  (items = the entries kept)
function pruneStaleEntries(items, { allowed = null, resolveSku = () => null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const skus = new Set(list.map((i) => i && i.sku));
  const kept = [];
  let notAllowed = 0;
  let brokenSku = 0;

  for (const entry of list) {
    const sku = entry && typeof entry.sku === 'string' ? entry.sku : String(entry?.sku);
    if (sku === '5021;6') {
      kept.push(entry);
      continue;
    }
    if (allowed && !allowed.has(entry?.name)) {
      notAllowed++;
      continue;
    }
    if (sku.includes('null')) {
      brokenSku++;
      continue;
    }
    let resolved = null;
    try {
      resolved = resolveSku(entry.name) || null;
      // A resolver working from a stale schema answers "null;6" for items it
      // does not know (every item newer than the cached schema): that is not a
      // resolution, so it must never prune a live entry.
      if (resolved && String(resolved).includes('null')) {
        resolved = null;
      }
    } catch {
      resolved = null;
    }
    if (resolved && resolved !== sku && skus.has(resolved)) {
      brokenSku++;
      continue;
    }
    kept.push(entry);
  }
  return { items: kept, notAllowed, brokenSku };
}

module.exports = { pruneStaleEntries };
