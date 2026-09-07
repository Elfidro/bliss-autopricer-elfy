// routes/actions.js
const path = require('path');
const { exec } = require('child_process');
const { loadJson, saveJson } = require('../utils');
const {
  validateItemName,
  validateItemSku,
  looksLikeSku,
  canonicalItemName,
  getSchemaManager,
} = require('../schemaInstance');

module.exports = function (app, config, configManager) {
  // Helper function to get current bot paths
  function getBotPaths() {
    const selectedBot = configManager.getSelectedBot();
    if (!selectedBot) {
      throw new Error('No bot selected. Please configure a bot first.');
    }

    return {
      pricelistPath: path.resolve(__dirname, '../../files/pricelist.json'),
      sellingPricelistPath: selectedBot.pricelistPath || path.resolve(__dirname, '../../files/pricelist.json'),
      itemListPath: path.resolve(__dirname, '../../files/item_list.json'),
    };
  }

  app.post('/bot/add', (req, res) => {
    try {
      const paths = getBotPaths();
      const sell = loadJson(paths.sellingPricelistPath);
      const main = loadJson(paths.pricelistPath);
      const sku = req.body.sku;
      const min = parseInt(req.body.min) || 1;
      const max = parseInt(req.body.max) || 1;

      if (!sell[sku]) {
        const item = main.items.find((i) => i.sku === sku);
        if (item) {
          sell[sku] = {
            sku: item.sku,
            name: item.name,
            enabled: true,
            autoprice: true,
            min: min,
            max: max,
            intent: 2,
            buy: item.buy,
            sell: item.sell,
            time: Math.floor(Date.now() / 1000),
            promoted: 0,
            group: 'all',
            note: { buy: null, sell: null },
            isPartialPriced: false,
          };
          saveJson(paths.sellingPricelistPath, sell);
          exec(`pm2 restart ${config.pm2ProcessName}`, (err, stdout, stderr) => {
            if (err) {
              console.error('PM2 restart error:', stderr);
            } else {
              console.log('Restarted tf2autobot:', stdout);
            }
          });
        }
      }
      res.redirect('back');
    } catch (error) {
      console.error('Error adding item to bot:', error);
      res.status(500).send('Error: ' + error.message);
    }
  });

  app.post('/bot/remove', (req, res) => {
    try {
      const paths = getBotPaths();
      const sell = loadJson(paths.sellingPricelistPath);
      const sku = req.body.sku;
      if (sell[sku]) {
        delete sell[sku];
        saveJson(paths.sellingPricelistPath, sell);
        exec(`pm2 restart ${config.pm2ProcessName}`, (err, stdout, stderr) => {
          if (err) {
            console.error('PM2 restart error:', stderr);
          } else {
            console.log('Restarted tf2autobot:', stdout);
          }
        });
      }
      res.redirect('back');
    } catch (error) {
      console.error('Error removing item from bot:', error);
      res.status(500).send('Error: ' + error.message);
    }
  });

  app.post('/add-item', (req, res) => {
    // The queue panel posts via fetch and ignores redirects, so answer it with
    // a status code it can act on. Form posts get a redirect with a message.
    const wantsJson = !String(req.get('accept') || '').includes('text/html');
    const fail = (status, message) => {
      if (wantsJson) {
        return res.status(status).json({ ok: false, error: message });
      }
      return res.redirect(`/?addError=${encodeURIComponent(message)}`);
    };

    try {
      const nameField = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      const skuField = typeof req.body.sku === 'string' ? req.body.sku.trim() : '';
      const input = skuField || nameField;
      if (!input) {
        return fail(400, 'No item name or SKU given.');
      }

      // One field takes either form: a sku is unambiguous by shape, so there is
      // no need to make the user say which they typed.
      const isSku = Boolean(skuField) || looksLikeSku(input);
      const check = isSku ? validateItemSku(input) : validateItemName(input);
      if (!check.ok) {
        console.warn(`Rejected item "${input}": ${check.reason}`);
        return fail(400, check.reason);
      }
      if (check.unverified) {
        console.warn(`Schema unavailable — adding "${input}" without verification.`);
      }
      // The watchlist is matched by name, so a sku we cannot resolve to a name
      // is useless; storing the sku string itself would silently collect
      // nothing. Better to say so than to accept it.
      if (isSku && !check.matchedName) {
        return fail(503, `Schema not loaded yet, so "${input}" cannot be resolved to an item name. Try again shortly, or add it by name.`);
      }

      // Store the schema's canonical name, not what was typed. The websocket
      // only ingests listings whose name is an exact match against this list
      // (websocket/bptfWebSocket.js), so "Nanobalaclava" instead of "The
      // Nanobalaclava" would silently collect nothing and never price.
      const canonical = check.matchedName || input;

      const paths = getBotPaths();
      const itemList = loadJson(paths.itemListPath);
      if (itemList.items.some((i) => i.name === canonical)) {
        return wantsJson
          ? res.json({ ok: true, duplicate: true })
          : res.redirect(`/?addError=${encodeURIComponent(`"${canonical}" is already tracked.`)}`);
      }

      itemList.items.push({ name: canonical });
      saveJson(paths.itemListPath, itemList);

      const renamed = canonical !== input ? ` (matched as "${canonical}")` : '';
      console.log(`Added item: ${canonical}${check.sku ? ` (${check.sku})` : ''}`);
      return wantsJson
        ? res.json({ ok: true, sku: check.sku, name: canonical })
        : res.redirect(`/?added=${encodeURIComponent(canonical + renamed)}`);
    } catch (error) {
      console.error('Error adding item:', error);
      return fail(500, error.message);
    }
  });

  // Removing only stops the websocket collecting new listings for the item.
  // Any price it already has stays in files/pricelist.json and simply goes
  // stale, so a removal here never destroys pricing data.
  app.post('/remove-item', (req, res) => {
    const wantsJson = !String(req.get('accept') || '').includes('text/html');
    const fail = (status, message) => {
      if (wantsJson) {
        return res.status(status).json({ ok: false, error: message });
      }
      return res.redirect(`/?addError=${encodeURIComponent(message)}`);
    };

    try {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        return fail(400, 'No item name given.');
      }

      const paths = getBotPaths();
      const itemList = loadJson(paths.itemListPath);
      const before = itemList.items.length;
      itemList.items = itemList.items.filter((i) => i.name !== name);

      if (itemList.items.length === before) {
        return fail(404, `"${name}" is not in the watchlist.`);
      }

      saveJson(paths.itemListPath, itemList);
      console.log(`Removed from watchlist: ${name}`);

      return wantsJson
        ? res.json({ ok: true, removed: name })
        : res.redirect(`/?removed=${encodeURIComponent(name)}`);
    } catch (error) {
      console.error('Error removing item:', error);
      return fail(500, error.message);
    }
  });

  // Copy everything the bot trades into the watchlist, so the pricer is
  // actually collecting listings for the items it is expected to price.
  //
  // The bot's pricelist is keyed by sku and each entry also carries a name,
  // but the name can be stale while the sku is authoritative — so resolve
  // through the schema and fall back to the stored name only if that fails.
  // The watchlist itself is matched by name (bptfWebSocket compares
  // item.name), so a sku that resolves to nothing cannot be imported.
  app.post('/import-bot-pricelist', (req, res) => {
    const wantsJson = !String(req.get('accept') || '').includes('text/html');
    const fail = (status, message) => {
      if (wantsJson) {
        return res.status(status).json({ ok: false, error: message });
      }
      return res.redirect(`/?addError=${encodeURIComponent(message)}`);
    };

    try {
      // Every configured bot, not just the selected one: the pricer serves all
      // of them, so anything any bot trades needs watching. Paths are deduped
      // because two config entries can point at the same pricelist.
      const allBots =
        typeof configManager.getAllBots === 'function' ? configManager.getAllBots() : [];
      const selected =
        typeof configManager.getSelectedBot === 'function' ? configManager.getSelectedBot() : null;
      const sources = allBots.length > 0 ? allBots : selected ? [selected] : [];

      const seenPath = new Set();
      const entries = [];
      const readFrom = [];
      const unreadable = [];

      for (const bot of sources) {
        const listPath = bot && bot.pricelistPath;
        if (!listPath || seenPath.has(listPath)) {
          continue;
        }
        seenPath.add(listPath);

        let contents;
        try {
          contents = loadJson(listPath);
        } catch (err) {
          unreadable.push(`${bot.name || bot.id}: ${err.message}`);
          continue;
        }

        const found = Object.entries(contents || {}).filter(([, v]) => v && typeof v === 'object');
        if (found.length === 0) {
          unreadable.push(`${bot.name || bot.id}: empty pricelist`);
          continue;
        }
        readFrom.push(`${bot.name || bot.id} (${found.length})`);
        entries.push(...found);
      }

      if (entries.length === 0) {
        return fail(
          404,
          `No bot pricelist could be read.${unreadable.length ? ' ' + unreadable.join('; ') : ''}`
        );
      }

      const paths = getBotPaths();
      const itemList = loadJson(paths.itemListPath);
      const tracked = new Set(itemList.items.map((i) => i.name));

      let added = 0;
      let already = 0;
      const unresolved = [];

      for (const [key, entry] of entries) {
        const sku = entry.sku || key;
        let resolved = null;

        const bySku = validateItemSku(sku);
        if (bySku.ok && bySku.matchedName) {
          resolved = bySku.matchedName;
        } else if (entry.name) {
          // Schema does not know the sku (crate series, unusual effects and
          // similar); the stored name is the only thing left to try.
          const byName = validateItemName(entry.name);
          if (byName.ok && byName.matchedName) resolved = byName.matchedName;
        }

        if (!resolved) {
          unresolved.push(entry.name || sku);
          continue;
        }
        if (tracked.has(resolved)) {
          already++;
          continue;
        }

        itemList.items.push({ name: resolved });
        tracked.add(resolved);
        added++;
      }

      if (added > 0) {
        saveJson(paths.itemListPath, itemList);
      }

      const summary =
        `Imported ${added} item${added === 1 ? '' : 's'} from ${readFrom.length} bot pricelist${readFrom.length === 1 ? '' : 's'}` +
        ` (${already} already tracked` +
        (unresolved.length ? `, ${unresolved.length} could not be resolved` : '') +
        (unreadable.length ? `, ${unreadable.length} unreadable` : '') +
        ').';

      console.log(
        `Bot pricelist import from ${readFrom.join(', ')}: ${entries.length} entries, ` +
          `${added} added, ${already} already tracked, ${unresolved.length} unresolved`
      );
      if (unreadable.length) {
        console.log(`Skipped: ${unreadable.join('; ')}`);
      }
      if (unresolved.length) {
        console.log(`Unresolved: ${unresolved.slice(0, 20).join(', ')}`);
      }

      return wantsJson
        ? res.json({ ok: true, added, already, unresolved, readFrom, unreadable })
        : res.redirect(`/?imported=${encodeURIComponent(summary)}`);
    } catch (error) {
      console.error('Error importing bot pricelist:', error);
      return fail(500, error.message);
    }
  });

  // Watchlist entries are matched against the listing feed by exact name, so
  // an entry the schema does not recognise — or one spelled differently from
  // the canonical name — collects nothing and sits Unpriced forever. This
  // finds those and either corrects the spelling or drops the entry.
  //
  // Send dryRun=true to get the plan without applying it; the UI previews
  // before asking for confirmation, because this deletes entries.
  app.post('/clean-watchlist', (req, res) => {
    const wantsJson = !String(req.get('accept') || '').includes('text/html');
    const fail = (status, message) => {
      if (wantsJson) {
        return res.status(status).json({ ok: false, error: message });
      }
      return res.redirect(`/?addError=${encodeURIComponent(message)}`);
    };

    // Without a schema every entry looks invalid, which would wipe the whole
    // watchlist. Refuse rather than destroy it.
    if (!getSchemaManager()?.schema) {
      return fail(503, 'Schema not loaded yet, so valid entries cannot be told from invalid ones. Try again shortly.');
    }

    try {
      const dryRun = req.body.dryRun === 'true' || req.body.dryRun === true;
      const paths = getBotPaths();
      const itemList = loadJson(paths.itemListPath);
      // Names that exist now, plus any a rename is about to create. Without
      // tracking the second kind, two entries that canonicalise to the same
      // name (" The Nanobalaclava" and "Nanobalaclava" both becoming "The
      // Nanobalaclava") would each be renamed and produce a duplicate.
      const claimed = new Set(itemList.items.map((i) => i.name));

      const remove = [];
      const rename = [];
      let keep = 0;

      for (const entry of itemList.items) {
        const info = canonicalItemName(entry.name);
        if (!info.resolved) {
          remove.push({ name: entry.name, reason: 'no matching item in the schema' });
        } else if (!info.canonical || info.canonical === entry.name) {
          // Already canonical, or a form whose canonical name cannot be
          // rebuilt (quality or attribute prefixes). Leave it rather than
          // guess — a wrong rename is worse than an entry we cannot judge.
          keep++;
        } else if (claimed.has(info.canonical)) {
          remove.push({ name: entry.name, reason: `duplicate of "${info.canonical}"` });
        } else {
          rename.push({ from: entry.name, to: info.canonical });
          claimed.add(info.canonical);
        }
      }

      if (dryRun) {
        return res.json({ ok: true, dryRun: true, keep, remove, rename });
      }

      if (remove.length === 0 && rename.length === 0) {
        const msg = 'Watchlist is already clean.';
        return wantsJson ? res.json({ ok: true, keep, remove, rename }) : res.redirect(`/?imported=${encodeURIComponent(msg)}`);
      }

      const removeSet = new Set(remove.map((r) => r.name));
      const renameMap = new Map(rename.map((r) => [r.from, r.to]));
      itemList.items = itemList.items
        .filter((i) => !removeSet.has(i.name))
        .map((i) => (renameMap.has(i.name) ? { ...i, name: renameMap.get(i.name) } : i));

      saveJson(paths.itemListPath, itemList);

      console.log(
        `Watchlist cleanup: ${keep} unchanged, ${rename.length} renamed, ${remove.length} removed`
      );
      rename.forEach((r) => console.log(`  renamed "${r.from}" -> "${r.to}"`));
      remove.forEach((r) => console.log(`  removed "${r.name}" (${r.reason})`));

      const summary =
        `Watchlist cleaned: ${rename.length} renamed, ${remove.length} removed, ${keep} unchanged.`;
      return wantsJson
        ? res.json({ ok: true, keep, remove, rename })
        : res.redirect(`/?imported=${encodeURIComponent(summary)}`);
    } catch (error) {
      console.error('Error cleaning watchlist:', error);
      return fail(500, error.message);
    }
  });

  app.post('/bot/edit', (req, res) => {
    try {
      const { sku, min, max } = req.body;
      if (!sku || isNaN(min) || isNaN(max)) {
        return res.status(400).send('Invalid edit');
      }

      const paths = getBotPaths();
      const pricelist = loadJson(paths.sellingPricelistPath);
      if (!pricelist[sku]) {
        return res.status(404).send('Item not found');
      }

      pricelist[sku].min = parseInt(min);
      pricelist[sku].max = parseInt(max);

      saveJson(paths.sellingPricelistPath, pricelist);

      exec('pm2 restart tf2autobot', (err, stdout, stderr) => {
        if (err) {
          console.error('PM2 restart error:', stderr);
        } else {
          console.log('Bot restarted after edit:', stdout);
        }
      });

      res.send('Updated');
    } catch (error) {
      console.error('Error editing item:', error);
      res.status(500).send('Error: ' + error.message);
    }
  });
};
