// tf2-schema reads a leading quality or unusual-effect word as exactly that, so
// an item whose own name starts with one never resolves: "Haunted Hoard Case
// #153" parses as Haunted quality + "Hoard Case" and "Frostbite Fit" as the
// Frostbite effect + "Fit", both coming back as a null-defindex SKU (null;13,
// null;5;u87). Every listing for them was filed under that SKU and the item
// could never be priced.
//
// When the parse fails this way, fall back to an exact item-name match (minus
// a trailing "#series"), as a Unique item. Names that already resolve are
// untouched, so a real Haunted or unusual item is still parsed as one.
const { Schema } = require('@tf2autobot/tf2-schema');

function resolveExactName(schema, name) {
  const m = /^(.*?)(?: #(\d+))?$/.exec(name.trim());
  const item = schema.getItemByItemName(m[1]);
  if (!item) {
    return null;
  }
  const quality = item.item_quality > 0 ? item.item_quality : 6;
  return `${item.defindex};${quality}` + (m[2] ? `;c${m[2]}` : '');
}

function patchSchema(SchemaClass = Schema) {
  const proto = SchemaClass.prototype;
  if (proto.getSkuFromName.__nameFix) {
    return;
  }
  const original = proto.getSkuFromName;
  proto.getSkuFromName = function (name) {
    const sku = original.call(this, name);
    if (typeof name === 'string' && typeof sku === 'string' && sku.startsWith('null;')) {
      return resolveExactName(this, name) || sku;
    }
    return sku;
  };
  proto.getSkuFromName.__nameFix = true;
}

patchSchema();

module.exports = { patchSchema, resolveExactName };
