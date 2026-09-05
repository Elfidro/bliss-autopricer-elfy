const fs = require('fs');
const express = require('express');

const router = express.Router();

const PRICELIST_PATH = './files/pricelist.json';
const ITEM_LIST_PATH = './files/item_list.json';

// Cached view of pricelist.json, invalidated on mtime/size change.
//
// tf2autobot asks for prices one sku at a time (GET /item/:sku), and every one
// of those requests used to read and JSON.parse the whole pricelist and then
// linearly scan it. On a pricelist with thousands of items that is megabytes of
// short-lived garbage per lookup, on the hot path of every bot startup and
// every autoprice pass. Now the file is parsed once per change and answered
// from a sku -> item map.
let pricelistCache = null; // { mtimeMs, size, raw, bySku }

function loadPricelist(callback) {
  fs.stat(PRICELIST_PATH, (statErr, stats) => {
    if (statErr) {
      return callback(statErr);
    }
    if (
      pricelistCache &&
      pricelistCache.mtimeMs === stats.mtimeMs &&
      pricelistCache.size === stats.size
    ) {
      return callback(null, pricelistCache);
    }

    fs.readFile(PRICELIST_PATH, 'utf8', (err, raw) => {
      if (err) {
        return callback(err);
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        return callback(parseErr);
      }

      const bySku = new Map();
      for (const item of parsed.items || []) {
        // First entry wins, matching the linear scan this replaced.
        if (!bySku.has(item.sku)) {
          bySku.set(item.sku, item);
        }
      }
      // The raw text is kept instead of the parsed object so GET / can stream
      // the file straight back without re-serialising it on every request.
      pricelistCache = { mtimeMs: stats.mtimeMs, size: stats.size, raw, bySku };
      return callback(null, pricelistCache);
    });
  });
}

// Get item price by SKU.
router.get('/:sku', async (req, res) => {
  loadPricelist((err, cache) => {
    if (err) {
      return res.status(400).json({ error: 'Failed to load pricelist.' });
    }

    const item = cache.bySku.get(req.params.sku);
    if (item) {
      return res.status(200).json(item);
    }
    // Item was not found in the pricelist.
    return res.sendStatus(404);
  });
});

// Get pricelist.
router.get('/', (req, res) => {
  loadPricelist((err, cache) => {
    if (err) {
      console.error(err);
      return res.status(400).json({ error: 'Failed to load pricelist.' });
    }

    // Send pricelist to requester.
    return res.status(200).type('application/json').send(cache.raw);
  });
});

// Request check endpoint. For now this will do
// nothing but return a status code of 200.
router.post('/:sku', (req, res) => {
  return res.status(200).json({ sku: req.params.sku });
});

// Routes for adding/removing items.
router.post('/add/:name', (req, res) => {
  let name = req.params.name;
  let item_found = false;
  let new_item = { name: name };

  // Check if item exists already.
  fs.readFile(ITEM_LIST_PATH, 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(400).json({ error: 'Failed to load item list.' });
    }

    try {
      data = JSON.parse(data);
      // Iterate over each item in the items JSON array.
      for (const item of data.items) {
        // Find the requested item.
        if (item.name === name) {
          item_found = true;
          break;
        }
      }
    } catch {
      return res.sendStatus(400);
    }

    // Item found, shouldn't add item again.
    if (item_found) {
      return res.sendStatus(400);
    } else {
      // Item was not found in the item list. Adding item.
      data.items.push(new_item);

      fs.writeFile(ITEM_LIST_PATH, JSON.stringify(data), 'utf8', (err) => {
        if (err) {
          return res.sendStatus(400);
        }
        return res.sendStatus(200);
      });
    }
  });
});

router.post('/delete/:name', (req, res) => {
  let name = req.params.name;
  let item_found = false;

  // Check if item exists.
  fs.readFile(ITEM_LIST_PATH, 'utf8', (err, data) => {
    if (err) {
      console.error(err);
      return res.status(400).json({ error: 'Failed to load item list.' });
    }
    try {
      data = JSON.parse(data);
      let items = data.items;
      // Iterate over each item in the items JSON array.
      for (var i = 0; i < items.length; i++) {
        let item = items[i];
        if (item.name === name) {
          item_found = true;
          items.splice(i, 1); // Remove the item from the JSON array.
          break;
        }
      }
    } catch {
      return res.sendStatus(400);
    }

    // Item found, saving version of item list with the item deleted.
    if (item_found) {
      fs.writeFile(ITEM_LIST_PATH, JSON.stringify(data), 'utf8', (err) => {
        if (err) {
          return res.sendStatus(400);
        }
        return res.sendStatus(200);
      });
    } else {
      return res.sendStatus(400);
    }
  });
});

module.exports = router;
