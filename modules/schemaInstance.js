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

module.exports = { setSchemaManager, getSchemaManager, validateItemName };
