// routes/actions.js
const path = require('path');
const { exec } = require('child_process');
const { loadJson, saveJson } = require('../utils');
const { validateItemName } = require('../schemaInstance');

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
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        return fail(400, 'No item name given.');
      }

      // Reject names the TF2 schema does not know, so typos and pasted junk
      // do not sit in the watchlist unpriced forever.
      const check = validateItemName(name);
      if (!check.ok) {
        console.warn(`Rejected item "${name}": ${check.reason}`);
        return fail(400, check.reason);
      }
      if (check.unverified) {
        console.warn(`Schema unavailable — adding "${name}" without verification.`);
      }

      // Store the schema's canonical name, not what was typed. The websocket
      // only ingests listings whose name is an exact match against this list
      // (websocket/bptfWebSocket.js), so "Nanobalaclava" instead of "The
      // Nanobalaclava" would silently collect nothing and never price.
      const canonical = check.matchedName || name;

      const paths = getBotPaths();
      const itemList = loadJson(paths.itemListPath);
      if (itemList.items.some((i) => i.name === canonical)) {
        return wantsJson
          ? res.json({ ok: true, duplicate: true })
          : res.redirect(`/?addError=${encodeURIComponent(`"${canonical}" is already tracked.`)}`);
      }

      itemList.items.push({ name: canonical });
      saveJson(paths.itemListPath, itemList);

      const renamed = canonical !== name ? ` (matched as "${canonical}")` : '';
      console.log(`Added item: ${canonical}${check.sku ? ` (${check.sku})` : ''}`);
      return wantsJson
        ? res.json({ ok: true, sku: check.sku, name: canonical })
        : res.redirect(`/?added=${encodeURIComponent(canonical + renamed)}`);
    } catch (error) {
      console.error('Error adding item:', error);
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
