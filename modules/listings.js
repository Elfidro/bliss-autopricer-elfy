const { updateListingStatsBatch } = require('./listingAverages');

const getListings = async (db, name, intent) => {
  return await db.result('SELECT * FROM listings WHERE name = $1 AND intent = $2', [name, intent]);
};

const insertListingsBatch = async (
  pgp,
  db,
  updateListingStats,
  listings // Array of [response_item, sku, currencies, intent, steamid]
) => {
  if (listings.length === 0) {
    return;
  }

  // De-duplicate: keep only the last occurrence for each unique key
  const dedupedMap = new Map();
  for (const entry of listings) {
    const [response_item, sku, intent, steamid] = entry;
    const key = `${response_item.name}|${sku}|${intent}|${steamid}`;
    dedupedMap.set(key, entry); // overwrites previous, so last wins
  }
  const dedupedListings = Array.from(dedupedMap.values());

  const timestamp = Math.floor(Date.now() / 1000);
  // Build the row objects once. This used to build an array of arrays and then
  // map it into an array of objects, holding two full copies of every listing
  // in the batch at the same time.
  const uniqueSkus = new Set();
  const rows = new Array(dedupedListings.length);
  for (let i = 0; i < dedupedListings.length; i++) {
    const [response_item, sku, currencies, intent, steamid] = dedupedListings[i];
    uniqueSkus.add(sku);
    rows[i] = {
      name: response_item.name,
      sku,
      currencies: JSON.stringify(currencies),
      intent,
      updated: timestamp,
      steamid,
    };
  }

  // Use pg-promise helpers for batch insert
  const cs = new pgp.helpers.ColumnSet(
    ['name', 'sku', 'currencies', 'intent', 'updated', 'steamid'],
    { table: 'listings' }
  );
  const query =
    pgp.helpers.insert(rows, cs) +
    ` ON CONFLICT (name, sku, intent, steamid)
      DO UPDATE SET currencies = EXCLUDED.currencies, updated = EXCLUDED.updated;`;

  await db.none(query);

  // Recount stats for every sku we touched in one statement. This used to fan
  // out one round-trip per sku (hundreds every flush), each building its own
  // query text and result object.
  await updateListingStatsBatch(db, Array.from(uniqueSkus));
};

const insertListing = async (
  db,
  updateListingStats,
  response_item,
  sku,
  currencies,
  intent,
  steamid
) => {
  let timestamp = Math.floor(Date.now() / 1000);
  const result = await db.none(
    `INSERT INTO listings (name, sku, currencies, intent, updated, steamid)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name, sku, intent, steamid)
         DO UPDATE SET currencies = $3, updated = $5;`,
    [response_item.name, sku, JSON.stringify(currencies), intent, timestamp, steamid]
  );
  await updateListingStats(db, sku);
  return result;
};

const deleteRemovedListing = async (db, updateListingStats, steamid, name, intent) => {
  const sku = (
    await db.oneOrNone(
      'SELECT sku FROM listings WHERE steamid = $1 AND name = $2 AND intent = $3 LIMIT 1',
      [steamid, name, intent]
    )
  )?.sku;
  const result = await db.any(
    'DELETE FROM listings WHERE steamid = $1 AND name = $2 AND intent = $3;',
    [steamid, name, intent]
  );
  if (sku) {
    await updateListingStats(db, sku);
  }
  return result;
};

const HARD_MAX_AGE_SECONDS = 5 * 24 * 60 * 60; // 5 days

// How long a listing may sit unrefreshed before it is dropped, by how active
// the sku is. Unchanged from the per-band JS version this replaced; expressed
// as SQL so the whole sweep is one statement instead of pulling every row of
// listing_stats into the process and sending back a dozen multi-megabyte
// "sku IN (...)" parameter lists.
const AGE_BANDS = (column) => `
  CASE
    WHEN ${column} > 10 THEN 7200
    WHEN ${column} > 8 THEN 14400
    WHEN ${column} > 6 THEN 28800
    WHEN ${column} > 4 THEN 172800
    WHEN ${column} > 2 THEN 432000
    ELSE 604800
  END`;

const deleteOldListings = async (db) => {
  await db.none(
    `
    DELETE FROM listings l
    USING listing_stats s
    WHERE l.sku = s.sku
      AND l.intent IN ('buy', 'sell')
      AND EXTRACT(EPOCH FROM NOW() - to_timestamp(l.updated)) >=
        CASE WHEN l.intent = 'buy'
             THEN ${AGE_BANDS('s.moving_avg_buy_count')}
             ELSE ${AGE_BANDS('s.moving_avg_sell_count')}
        END
  `
  );

  // Fail safe: delete any listing older than the hard max age
  await db.none(
    'DELETE FROM listings WHERE EXTRACT(EPOCH FROM NOW() - to_timestamp(updated)) >= $1',
    [HARD_MAX_AGE_SECONDS]
  );
};

module.exports = {
  getListings,
  insertListing,
  insertListingsBatch,
  deleteRemovedListing,
  deleteOldListings,
};
