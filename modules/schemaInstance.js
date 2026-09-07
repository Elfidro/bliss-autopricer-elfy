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
// ";uncraftable", ";australium", ";kt-3" or ";u<effect>".
const SKU_PATTERN = /^\d+;\d+(?:;[^;\s]+)*$/;

function looksLikeSku(value) {
  return SKU_PATTERN.test(String(value).trim());
}

/**
 * Check a sku against the TF2 schema and resolve the name the websocket feed
 * will use for it.
 *
 * Returns { ok: true, sku, matchedName } for a real item, or
 * { ok: false, reason }. As with validateItemName, an unloaded schema returns
 * ok with `unverified: true` rather than blocking the user.
 */
function validateItemSku(sku) {
  const trimmed = String(sku).trim();
  if (!looksLikeSku(trimmed)) {
    return { ok: false, reason: `"${trimmed}" is not a SKU. Expected something like 31628;6.` };
  }

  const schema = getSchemaManager()?.schema;
  if (!schema || typeof schema.getItemBySKU !== 'function') {
    return { ok: true, sku: trimmed, unverified: true };
  }

  let item = null;
  try {
    item = schema.getItemBySKU(trimmed);
  } catch {
    item = null;
  }
  if (!item) {
    return { ok: false, reason: `No TF2 item matches SKU "${trimmed}".` };
  }

  // The websocket matches on the listing's item name, not its sku, so a sku
  // add still has to be stored as a name.
  let name = null;
  try {
    if (typeof schema.getName === 'function') name = schema.getName(trimmed, true);
  } catch {
    name = null;
  }
  if (!name) name = item.item_name || item.name || null;
  if (!name) {
    return { ok: false, reason: `SKU "${trimmed}" resolved to an item with no usable name.` };
  }

  // Normalise through the name path so the "The " handling stays in one place.
  const viaName = validateItemName(name);
  if (viaName.ok && viaName.matchedName) name = viaName.matchedName;

  return { ok: true, sku: trimmed, matchedName: name };
}


/**
 * The name the listing feed will actually use for this item, or null if the
 * name resolves to nothing.
 *
 * backpack.tf builds listing names from the schema, so an entry stored under
 * any other spelling can never match — "Nanobalaclava" against the schema's
 * "The Nanobalaclava" being the usual case. validateItemName deliberately
 * accepts both forms so a user can type either; this resolves which one the
 * feed will send.
 */
function canonicalItemName(name) {
  const check = validateItemName(name);
  if (!check.ok || !check.sku) {
    return null;
  }
  const schema = getSchemaManager()?.schema;
  if (schema && typeof schema.getName === 'function') {
    try {
      const proper = schema.getName(check.sku, true);
      if (proper) return proper;
    } catch {
      // fall through to the matched candidate
    }
  }
  return check.matchedName || null;
}

module.exports = {
  setSchemaManager,
  getSchemaManager,
  validateItemName,
  validateItemSku,
  looksLikeSku,
  canonicalItemName,
};


