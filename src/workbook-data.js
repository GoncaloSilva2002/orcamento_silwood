// Compatibility entry point. Runtime data and calculations no longer read Excel.
const { createPricingEngine } = require('./pricing-engine');
module.exports = createPricingEngine(require('../data/catalog-seed.json'));
