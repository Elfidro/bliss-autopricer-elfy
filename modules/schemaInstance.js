// Shared handle on the TF2 schema manager.
//
// bptf-autopricer.js owns the instance, but route modules need it too and
// cannot require that file without a circular import (bptf-autopricer ->
// modules/index -> routes/* -> bptf-autopricer). Same injection pattern as
// API/routes/schema-status.js.

let schemaManagerInstance = null;

function setSchemaManager(manager) {
  schemaManagerInstance = manager;
}

function getSchemaManager() {
  return schemaManagerInstance;
}

/**
 * Check a name against the TF2 item schema.
 *
 * Returns { ok: true, sku, matchedName } for a recognised item, or
 * { ok: false, reason } otherwise. If the schema has not loaded yet this
 * returns ok with `unverified: true` — a schema hiccup should not stop the
 * user adding items.
 */
function validateItemName(name) {
  const manager = getSchemaManager();
  const schema = manager?.schema;

  if (!schema || typeof schema.getSkuFromName !== 'function') {
    return { ok: true, unverified: true };
  }

  const trimmed = String(name).trim();
  if (!trimmed) {
    return { ok: false, reason: 'Name is empty.' };
  }
  if (/[\r\n\t]|\\n/.test(trimmed)) {
    return { ok: false, reason: 'Name contains line breaks or escape sequences.' };
  }

  // The pricer already retries with and without a leading "The " when looking
  // up listings, so accept either form here rather than rejecting on it.
  const candidates = [trimmed];
  if (trimmed.startsWith('The ')) {
    candidates.push(trimmed.slice(4));
  } else {
    candidates.push(`The ${trimmed}`);
  }

  for (const candidate of candidates) {
    let sku;
    try {
      sku = schema.getSkuFromName(candidate);
    } catch {
      continue;
    }
    // An unknown name yields a malformed sku such as "null;6" rather than
    // throwing, so confirm the sku resolves back to a real schema item.
    if (!sku || /^(null|undefined|-1)\b/.test(String(sku))) {
      continue;
    }
    let item = null;
    try {
      item = schema.getItemBySKU(sku);
    } catch {
      item = null;
    }
    if (item) {
      return { ok: true, sku, matchedName: candidate };
    }
  }

  return { ok: false, reason: `"${trimmed}" is not a recognised TF2 item.` };
}


// A sku is "<defindex>;<quality>" plus optional suffixes such as
// ";uncraftable", ";australium", ";kt-3", ";u<effect>" or ";c<series>".
const SKU_PATTERN = /^\d+;\d+(?:;[^;\s]+)*$/;

function looksLikeSku(value) {
  return SKU_PATTERN.test(String(value).trim());
}

/**
 * Build the name the listing feed uses for a sku, from the schema item.
 *
 * Deliberately does not use schema.getName(): with a cached schema it returns
 * the same wrong string for every sku ("null RGL.gg - Amateur Participant -
 * 6v6"), which would rename every watchlist entry to that. Reconstructing the
 * two forms we can be sure of is worth more than a call that silently lies.
 *
 * Returns null when the sku carries quality or attribute prefixes we cannot
 * rebuild ("Strange", "Australium", killstreak tiers, unusual effects).
 * Callers must treat null as "cannot say", never as "no such item".
 */
function displayNameForSku(sku, item) {
  const base = item && (item.item_name || item.name);
  if (!base) {
    return null;
  }

  const parts = String(sku).split(';');

  // Crate series: "Abominable Cosmetic Case" + series 107 -> "... #107".
  const crate = parts.find((p) => /^c\d+$/.test(p));
  if (crate) {
    return `${base} #${crate.slice(1)}`;
  }

  // Plain Unique, no attributes: the only variation is the "The " prefix,
  // which the schema records as proper_name.
  if (parts.length === 2 && parts[1] === '6') {
    return item.proper_name ? `The ${base}` : base;
  }

  return null;
}

function hasSchema() {
  const schema = getSchemaManager()?.schema;
  return Boolean(schema && typeof schema.getItemBySKU === 'function');
}

// Returns the schema item, or null when the sku matches nothing. Callers must
// check hasSchema() separately: "schema not loaded" and "no such item" need
// different answers, and conflating them reported unknown skus as an outage.
function schemaItemForSku(sku) {
  if (!hasSchema()) {
    return null;
  }
  try {
    return getSchemaManager().schema.getItemBySKU(sku) || null;
  } catch {
    return null;
  }
}

/**
 * Check a sku against the TF2 schema and resolve the name the feed will use.
 *
 * Returns { ok: true, sku, matchedName } for a real item, or
 * { ok: false, reason }. An unloaded schema returns ok with
 * `unverified: true` and no name, which callers must handle.
 */
function validateItemSku(sku) {
  const trimmed = String(sku).trim();
  if (!looksLikeSku(trimmed)) {
    return { ok: false, reason: `"${trimmed}" is not a SKU. Expected something like 31628;6.` };
  }

  if (!hasSchema()) {
    return { ok: true, sku: trimmed, unverified: true };
  }

  const item = schemaItemForSku(trimmed);
  if (!item) {
    return { ok: false, reason: `No TF2 item matches SKU "${trimmed}".` };
  }

  const name = displayNameForSku(trimmed, item);
  if (!name) {
    return {
      ok: false,
      reason: `SKU "${trimmed}" has quality or attribute parts this cannot name reliably. Add it by name instead.`,
    };
  }

  return { ok: true, sku: trimmed, matchedName: name };
}

/**
 * Work out the name the feed will send for an existing watchlist entry.
 *
 * `resolved` false means the name matches no schema item at all. `resolved`
 * true with a null `canonical` means the item exists but its canonical form
 * cannot be determined — callers must leave those alone rather than treating
 * them as broken.
 */
function canonicalItemName(name) {
  const check = validateItemName(name);
  if (!check.ok || !check.sku) {
    return { resolved: false, canonical: null };
  }
  const item = schemaItemForSku(check.sku);
  if (!item) {
    return { resolved: false, canonical: null };
  }
  return { resolved: true, canonical: displayNameForSku(check.sku, item) };
}

module.exports = {
  setSchemaManager,
  getSchemaManager,
  validateItemName,
  validateItemSku,
  looksLikeSku,
  canonicalItemName,
  displayNameForSku,
};
