// routes/actions.js
const path = require('path');
const { exec } = require('child_process');
const { loadJson, saveJson } = require('../utils');

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
    try {
      const { name } = req.body;
      if (!name) {
        return res.redirect('back');
      }

      const paths = getBotPaths();
      const itemList = loadJson(paths.itemListPath);
      if (!itemList.items.some((i) => i.name === name)) {
        itemList.items.push({ name });
        saveJson(paths.itemListPath, itemList);
      }

      console.log(`Added item: ${name}`);
      res.redirect('back');
    } catch (error) {
      console.error('Error adding item:', error);
      res.status(500).send('Error: ' + error.message);
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
