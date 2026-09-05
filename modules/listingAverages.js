async function updateMovingAverages(db, pgp, alpha = 0.35) {
  if (alpha <= 0 || alpha > 1) {
    throw new Error('Alpha must be between 0 (exclusive) and 1 (inclusive).');
  }
  const stats = await db.any(`
        SELECT sku, current_count, moving_avg_count,
               current_buy_count, moving_avg_buy_count,
               current_sell_count, moving_avg_sell_count
        FROM listing_stats
    `);
  if (stats.length === 0) {
    return;
  }

  // clampAndRound ensures all moving averages:
  // - are rounded to 2 decimal places (e.g., 1.2345 -> 1.23)
  // - never go below the minimum value (default 0.05, which is already very small for item averages)
  // This prevents extremely small values that could cause database errors with float columns.
  const clampAndRound = (val, min = 0.05) => Math.max(min, Math.round(val * 100) / 100);

  // One pass: compute the new averages and keep only the rows that actually
  // moved. The old version mapped every row and then, for each result, scanned
  // the whole stats array again to find its original - O(n^2) over a table that
  // grows to tens of thousands of skus, with a full intermediate array of every
  // row (changed or not) alive at the same time.
  const updates = [];
  for (const row of stats) {
    const prevAvg = row.moving_avg_count ?? row.current_count;
    const prevBuyAvg = row.moving_avg_buy_count ?? row.current_buy_count;
    const prevSellAvg = row.moving_avg_sell_count ?? row.current_sell_count;

    const newAvg = clampAndRound(alpha * row.current_count + (1 - alpha) * prevAvg);
    const newBuyAvg = clampAndRound(alpha * row.current_buy_count + (1 - alpha) * prevBuyAvg);
    const newSellAvg = clampAndRound(alpha * row.current_sell_count + (1 - alpha) * prevSellAvg);

    const changed =
      Math.abs(prevAvg - newAvg) > 1e-6 ||
      Math.abs(prevBuyAvg - newBuyAvg) > 1e-6 ||
      Math.abs(prevSellAvg - newSellAvg) > 1e-6;
    if (!changed) {
      continue;
    }

    updates.push({
      sku: row.sku,
      moving_avg_count: newAvg,
      moving_avg_buy_count: newBuyAvg,
      moving_avg_sell_count: newSellAvg,
    });
  }

  if (updates.length === 0) {
    console.log('No moving averages changed.');
    return;
  }

  const cs = new pgp.helpers.ColumnSet(
    ['sku', 'moving_avg_count', 'moving_avg_buy_count', 'moving_avg_sell_count'],
    { table: 'tmp' }
  );
  const values = pgp.helpers.values(updates, cs);

  try {
    await db.none(`
            UPDATE listing_stats AS ls
            SET moving_avg_count = tmp.moving_avg_count,
                moving_avg_buy_count = tmp.moving_avg_buy_count,
                moving_avg_sell_count = tmp.moving_avg_sell_count,
                last_updated = NOW()
            FROM (VALUES ${values}) AS tmp(sku, moving_avg_count, moving_avg_buy_count, moving_avg_sell_count)
            WHERE ls.sku = tmp.sku
        `);

    // Deliberately not read back and logged: the old code re-selected every
    // updated row and console.logged the whole array, which allocated a second
    // copy of the result set and wrote megabytes into the pm2 log each run.
    console.log(`Updated moving averages for ${updates.length} skus.`);
  } catch (err) {
    console.error('Error updating moving averages:', err);
  }
}

// Recount stats for many skus in a single statement.
//
// The per-sku version below is still used on the single-listing paths, but the
// batch paths used to call it once per sku - hundreds of round-trips per
// websocket flush, each allocating its own query text and result object.
async function updateListingStatsBatch(db, skus) {
  if (!skus || skus.length === 0) {
    return;
  }
  await db.none(
    `
    INSERT INTO listing_stats (sku, current_count, current_buy_count, current_sell_count, last_updated)
    SELECT sku,
           COUNT(*),
           COUNT(*) FILTER (WHERE intent = 'buy'),
           COUNT(*) FILTER (WHERE intent = 'sell'),
           NOW()
    FROM listings
    WHERE sku IN ($1:csv)
    GROUP BY sku
    ON CONFLICT (sku) DO UPDATE SET
        current_count = EXCLUDED.current_count,
        current_buy_count = EXCLUDED.current_buy_count,
        current_sell_count = EXCLUDED.current_sell_count,
        last_updated = NOW()
  `,
    [skus]
  );
}

async function updateListingStats(db, sku) {
  const { overall, buy, sell } = await db.one(
    `SELECT
            COUNT(*) AS overall,
            COUNT(*) FILTER (WHERE intent = 'buy') AS buy,
            COUNT(*) FILTER (WHERE intent = 'sell') AS sell
         FROM listings WHERE sku = $1`,
    [sku]
  );
  await db.none(
    `
        INSERT INTO listing_stats (sku, current_count, current_buy_count, current_sell_count, last_updated)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (sku) DO UPDATE SET
            current_count = $2,
            current_buy_count = $3,
            current_sell_count = $4,
            last_updated = NOW()
    `,
    [sku, overall, buy, sell]
  );
  //console.log(`Updated stats for SKU ${sku}: overall=${overall}, buy=${buy}, sell=${sell}`);
}

async function initializeListingStats(db) {
  const skus = await db.any('SELECT DISTINCT sku FROM listings');
  console.log(`Initializing listing stats for ${skus.length} SKUs...`);
  // Chunked so the parameter list stays a sane size on a large listings table.
  const CHUNK = 2000;
  for (let i = 0; i < skus.length; i += CHUNK) {
    await updateListingStatsBatch(
      db,
      skus.slice(i, i + CHUNK).map((r) => r.sku)
    );
  }
  console.log('Listing stats initialized.');
}

module.exports = {
  updateMovingAverages,
  updateListingStats,
  updateListingStatsBatch,
  initializeListingStats,
};
