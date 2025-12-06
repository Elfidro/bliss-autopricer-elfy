const { getBaseConfigManager } = require('./baseConfigManager');

function scheduleTasks({
  updateExternalPricelist,
  calculateAndEmitPrices,
  updateKeyObject,
  updateMovingAverages,
  db,
  pgp,
}) {
  const config = getBaseConfigManager().getConfig();
  const intervals = config.schedulerIntervals || {
    updatePricelist: 1800000,
    calculatePrices: 900000,
    updateKeyPrice: 900000,
    updateMovingAverages: 900000,
  };

  setInterval(updateExternalPricelist, intervals.updatePricelist);
  setInterval(calculateAndEmitPrices, intervals.calculatePrices);
  setInterval(updateKeyObject, intervals.updateKeyPrice);
  setInterval(() => updateMovingAverages(db, pgp), intervals.updateMovingAverages);
}

module.exports = scheduleTasks;
