const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPricingEngine } = require('../src/pricing-engine');
const { createCatalogStore } = require('../src/catalog-store');
const seed = require('../data/catalog-seed.json');

test('pricing matches pre-migration results for every type and pricing mode', () => {
  const engine = createPricingEngine(structuredClone(seed));
  for (const entry of require('./fixtures/pricing-baseline.json')) {
    assert.deepEqual(engine.calculateModulePrice(entry.input, entry.mode), entry.result);
  }
});

test('local persistence survives reload and rejects stale revisions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'silwood-store-'));
  const options = {mode:'local', file:path.join(directory,'catalog.json')};
  const store = createCatalogStore(options);
  const row = await store.read();
  row.data.catalog.plates[0].supplierPrice = 123.45;
  await store.save(row.data, row.revision);
  assert.equal((await createCatalogStore(options).read()).data.catalog.plates[0].supplierPrice, 123.45);
  await assert.rejects(store.save(row.data, row.revision), /alterado/);
});

test('Supabase failures and write conflicts are reported without local fallback', async () => {
  const originalFetch = global.fetch;
  try {
    const store = createCatalogStore({mode:'supabase',url:'https://example.supabase.co',key:'test'});
    global.fetch = async () => new Response('[]',{status:200});
    await assert.rejects(store.read(), /nao importado/);
    await assert.rejects(store.save(seed,1), /outro utilizador/);
    global.fetch = async () => new Response('secret remote error',{status:500});
    await assert.rejects(store.read(), error => error.message.includes('HTTP 500') && !error.message.includes('secret'));
  } finally { global.fetch = originalFetch; }
});

test('application works without Excel: bootstrap, calculate, authorization, save and reload', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'silwood-api-'));
  Object.assign(process.env, {CATALOG_STORAGE:'local', CATALOG_LOCAL_FILE:path.join(directory,'catalog.json'), SUPABASE_URL:'', SUPABASE_ANON_KEY:'', SUPABASE_SERVICE_ROLE_KEY:'', SILWOOD_ADMIN_USER:'test-admin', SILWOOD_ADMIN_PASSWORD:'test-password'});
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function(name, ...args) {
    if (name === 'xlsx' || name === 'child_process') throw new Error('Excel dependency attempted');
    return originalLoad.call(this,name,...args);
  };
  const originalRead = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (/\.(xlsm|xlsx|xls)$/i.test(String(file))) throw new Error('Excel read attempted');
    return originalRead.call(this,file,...args);
  };
  let server;
  try {
    const { app } = require('../src/server');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening',resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const request = (url,method='GET',body,cookie='') => fetch(base+url,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});
    const bootstrap = await (await request('/api/bootstrap')).json();
    assert.equal(bootstrap.source.storage,'local');
    assert.equal(bootstrap.catalog.plates.length,seed.catalog.plates.length);
    const quote = await (await request('/api/calculate','POST',bootstrap)).json();
    assert.ok(Number.isFinite(quote.totals.finalTotal));
    const payload = {plates:[{...bootstrap.catalog.plates[0],supplierPrice:123.45}]};
    assert.equal((await request('/api/supplier-prices','PUT',payload)).status,401);
    const login = await request('/api/login','POST',{username:'test-admin',password:'test-password'});
    assert.equal(login.status,200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const save = await request('/api/supplier-prices','PUT',payload,cookie);
    assert.equal(save.status,200,await save.clone().text());
    assert.equal((await save.json()).saved.updated,1);
    const loaded = await (await request('/api/bootstrap')).json();
    assert.equal(loaded.catalog.plates[0].supplierPrice,123.45);
    assert.equal(loaded.catalog.plates[0].cost,125.47);
    const renamed = {...loaded.catalog.plates[0],__dirtyIndex:0,name:'Placa teste editada'};
    const editSave = await request('/api/supplier-prices','PUT',{plates:[renamed]},cookie);
    assert.equal(editSave.status,200,await editSave.clone().text());
    const edited = await (await request('/api/bootstrap')).json();
    assert.equal(edited.catalog.plates[0].name,'Placa teste editada');
    assert.equal(edited.catalog.plates.filter(item => item.name === 'Placa teste editada').length,1);
    const staleRename = {...edited.catalog.plates[0],name:'Nome sem indice antigo'};
    delete staleRename.__dirtyIndex;
    const staleSave = await request('/api/supplier-prices','PUT',{plates:[staleRename]},cookie);
    assert.equal(staleSave.status,200,await staleSave.clone().text());
    const afterStale = await (await request('/api/bootstrap')).json();
    assert.equal(afterStale.catalog.plates.some(item => item.name === 'Nome sem indice antigo'),false);
    assert.equal(afterStale.catalog.plates.length,seed.catalog.plates.length);
    const deletedName = edited.catalog.plates[1].name;
    const directDelete = await request('/api/supplier-prices/item','DELETE',{type:'plates',index:1},cookie);
    assert.equal(directDelete.status,200,await directDelete.clone().text());
    const deleted = await (await request('/api/bootstrap')).json();
    assert.equal(deleted.catalog.plates.some(item => item.name === deletedName),false);
    assert.equal(deleted.catalog.plates.filter(item => item.name === 'Placa teste editada').length,1);
    assert.equal(deleted.catalog.plates.length,seed.catalog.plates.length - 1);
    const disk = await createCatalogStore({mode:'local',file:process.env.CATALOG_LOCAL_FILE}).read();
    assert.equal(disk.data.catalog.plates[0].name,'Placa teste editada');
  } finally {
    Module._load = originalLoad;
    fs.readFileSync = originalRead;
    if (server) await new Promise(resolve=>server.close(resolve));
  }
});
