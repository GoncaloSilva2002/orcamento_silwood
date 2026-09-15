const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const normalization = source.slice(source.indexOf('function normalizePlateItemName('), source.indexOf('function basePlateGroupKey('));
const editing = source.slice(source.indexOf("  supplierPricesGrid.querySelectorAll('[data-supplier-index]')"), source.indexOf("  supplierPricesGrid.querySelectorAll('[data-handle-use]')"));

test('editing plate names and references independently survives recalculation and reload', () => {
  for (const flags of [{ userAdded: true }, { comparisonSource: 'PLACAS_26' }, {}]) {
    let input;
    const item = { name: 'Nome personalizado', reference: 'F167 BRI - 19mm', ...flags };
    const context = vm.createContext({
      state: { supplierPrices: [item] },
      supplierPricesGrid: {
        querySelectorAll: () => [{ addEventListener: (_, callback) => { input = callback; } }],
        querySelector: () => null
      },
      clone: structuredClone,
      num: Number,
      plateGroupKey: () => 'grupo-original',
      plateCompareGroupName: () => 'Nome personalizado',
      calculateSupplierRow: () => {},
      updateSupplierAddition: () => {},
      updateSupplierMoneyCell: () => {},
      trackSupplierChange: () => {},
      scheduleSupplierRecalculation: () => vm.runInContext('normalizePlateItemName(state.supplierPrices[0])', context),
      canonicalPlateNameFromReference: () => 'Nome derivado da referencia'
    });
    vm.runInContext(normalization + editing, context);
    const edit = (field, value) => input({ target: { dataset: { supplierIndex: '0', supplierField: field }, value, closest: () => null } });
    edit('reference', 'DO - F167 EXT - 16mm');
    assert.equal(item.name, 'Nome personalizado');
    assert.equal(item.reference, 'DO - F167 EXT - 16mm');
    edit('name', 'Nome escolhido pelo utilizador');
    assert.equal(item.reference, 'DO - F167 EXT - 16mm');
    context.state.supplierPrices[0] = JSON.parse(JSON.stringify(item));
    vm.runInContext('normalizePlateItemName(state.supplierPrices[0])', context);
    assert.equal(context.state.supplierPrices[0].name, 'Nome escolhido pelo utilizador');
    edit('reference', '');
    assert.equal(context.state.supplierPrices[0].name, 'Nome escolhido pelo utilizador');
    assert.equal(context.state.supplierPrices[0].reference, '');
  }
});

test('drafts find materials by ID after filtering and never recreate missing saved rows', () => {
  const context = vm.createContext({ clone: structuredClone, normalizeKnownDrawerComponentName: () => {}, normalizePlateItemName: () => {} });
  vm.runInContext(source.slice(source.indexOf('function findSupplierDraftTarget('), source.indexOf('function applySupplierDraftChanges(')), context);
  const first = { catalogId: 'a', name: 'Primeiro', reference: 'REF' };
  const second = { catalogId: 'b', name: 'Segundo', reference: 'REF' };
  const list = [first, second];
  context.mergeSupplierDraftList(list, [{ catalogId: 'b', __dirtyIndex: 0, reference: 'NOVA' }], 'name');
  assert.equal(first.reference, 'REF');
  assert.equal(second.reference, 'NOVA');
  context.mergeSupplierDraftList(list, [{ catalogId: 'apagado', __dirtyIndex: 0, reference: 'OUTRA' }], 'name');
  assert.equal(list.length, 2);
  assert.equal(first.reference, 'REF');
});
