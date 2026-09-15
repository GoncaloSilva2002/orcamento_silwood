const test = require('node:test');
const assert = require('node:assert/strict');
const { arrange } = require('../public/led-transformers');
const catalog = [15, 21, 36, 60].map(w => ({ group: 'LED', item: 'Transformador ' + w + 'W', client: w, cost: w / 2 }));
const led = (quantity, group = 'a') => ({ group: 'LED', item: 'KIT LED', quantity, furnitureGroupId: group });
test('LED transformer selects exact or next higher power and updates without duplicates', () => {
  assert.equal(arrange([led(2)], catalog).extras[1].item, 'Transformador 21W');
  const result = arrange([led(3)], catalog);
  assert.equal(result.extras[1].item, 'Transformador 36W');
  assert.equal(arrange(result.extras, catalog).extras.length, 2);
  result.extras[0].quantity = 5;
  assert.equal(arrange(result.extras, catalog).extras[1].item, 'Transformador 60W');
  result.extras[0].quantity = 0;
  assert.equal(arrange(result.extras, catalog).extras.length, 1);
});
test('LED loads sum per furniture group, reuse sufficient manual transformer, and report missing power', () => {
  const result = arrange([led(1), led(2), led(1, 'b')], catalog);
  assert.deepEqual(result.extras.slice(3).map(x => x.item), ['Transformador 36W', 'Transformador 15W']);
  const manual = { ...catalog[3], quantity: 1, furnitureGroupId: 'a' };
  assert.equal(arrange([led(3), manual], catalog).extras.length, 2);
  const missing = arrange([led(10)], catalog);
  assert.equal(missing.extras.length, 1);
  assert.match(missing.warnings[0], /105 W/);
  assert.equal(arrange([{ item: 'Perfil LED', quantity: 3 }, { item: 'Sensor LED', quantity: 1 }], catalog).extras.length, 2);
});
