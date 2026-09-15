const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('saving untouched displayed prices keeps automatic prices and full precision', () => {
  let tracked = 0;
  const item = { client: 10.014, manualClient: false };
  const context = vm.createContext({
    supplierManualPriceList: () => [item],
    num: value => Number(String(value).replace(',', '.')),
    salePriceValue: Number,
    supplierNumber: value => Number(value).toFixed(2),
    clone: structuredClone,
    ensureManualPriceBaseline: () => {},
    trackManualPriceChange: () => { tracked += 1; }
  });
  vm.runInContext(source.slice(source.indexOf('function commitSupplierManualPriceInput('), source.indexOf('function commitVisibleSupplierManualPrices(')), context);
  const input = { dataset: { manualPriceType: 'plates', manualPriceIndex: '0', manualPriceField: 'client' }, value: '10.01' };
  assert.equal(context.commitSupplierManualPriceInput(input), false);
  assert.equal(item.client, 10.014);
  assert.equal(item.manualClient, false);
  assert.equal(tracked, 0);
  input.value = '12,34';
  assert.equal(context.commitSupplierManualPriceInput(input), true);
  assert.equal(item.client, 12.34);
  assert.equal(item.manualClient, true);
  assert.equal(context.commitSupplierManualPriceInput(input), false);
  assert.equal(tracked, 1);
});

test('a refresh failure after saving acknowledges the save; a write failure retains drafts', async () => {
  for (const succeeds of [true, false]) {
    let pending = true;
    const button = {};
    const context = vm.createContext({
      document: { querySelector: () => button },
      sourceStatus: {}, state: {}, console: { error: () => {} },
      canManagePrices: () => true,
      commitVisibleSupplierManualPrices: () => {}, flushSupplierDraftPersist: () => {},
      supplierRecalculationTimer: null,
      hasSupplierDirtyChanges: () => pending,
      supplierDirtyPayload: () => ({ plates: [{ catalogId: 'a', reference: 'NEW' }] }),
      acknowledgeSupplierChanges: () => { pending = false; },
      fetch: async () => ({ ok: succeeds }),
      readJson: async () => ({ plates: [], error: 'Write failed' }),
      normalizeAllPlateNames: () => { throw new Error('Refresh failed'); }
    });
    vm.runInContext(source.slice(source.indexOf('async function saveSupplierPrices('), source.indexOf('async function showView(')), context);
    if (succeeds) {
      await context.saveSupplierPrices();
      assert.equal(pending, false);
      assert.match(context.sourceStatus.textContent, /Precos guardados/);
    } else {
      await assert.rejects(context.saveSupplierPrices(), /Write failed/);
      assert.equal(pending, true);
    }
    assert.equal(button.disabled, false);
  }
});

test('acknowledging a save preserves edits made during the request', () => {
  const saved = { catalogId: 'a', reference: 'saved' };
  const changed = { catalogId: 'b', reference: 'newer edit' };
  const changes = new Map([['a', saved], ['b', changed]]);
  const context = vm.createContext({ supplierDirtyChanges: { plates: changes }, supplierDirtyKey: item => item.catalogId, persistSupplierDraftChanges: () => {} });
  vm.runInContext(source.slice(source.indexOf('function acknowledgeSupplierChanges('), source.indexOf('function persistSupplierDraftChanges(')), context);
  context.acknowledgeSupplierChanges({ plates: [saved, { catalogId: 'b', reference: 'old edit' }] });
  assert.equal(changes.has('a'), false);
  assert.equal(changes.get('b'), changed);
});
