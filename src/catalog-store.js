const fs = require('fs');
const path = require('path');

function validateCatalog(data) {
  if (!data || data.schemaVersion !== 1 || !data.catalog || !data.lists || !data.typePresets || !data.feetPrices) {
    throw new Error('Catálogo inválido ou versão não suportada.');
  }
  for (const key of ['plates', 'paintings', 'doorSystems', 'hinges', 'hingeComponents', 'openingSystemComponents', 'edges', 'extras', 'paintingComponents', 'paintingMixDetails', 'paintRecipes', 'drawerComponents', 'drawerRecipes']) {
    if (!Array.isArray(data.catalog[key])) throw new Error('Categoria inválida: ' + key);
  }
  return data;
}

function createCatalogStore(options = {}) {
  const url = String(options.url || '').replace(/\/+$/, '');
  const key = options.key;
  const mode = options.mode || (url ? 'supabase' : 'local');
  const file = options.file || path.join(__dirname, '../data/catalog-local.json');
  const seed = options.seed || path.join(__dirname, '../data/catalog-seed.json');
  if (!['local', 'supabase'].includes(mode)) throw new Error('CATALOG_STORAGE deve ser local ou supabase.');
  async function request(resource, init = {}) {
    if (!url || !key) throw new Error('Configura SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor.');
    const response = await fetch(url + '/rest/v1/' + resource, {
      ...init,
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
      // Do not expose credentials or remote response details to the browser.
      if (response.status === 409) throw new Error('O catálogo foi alterado por outro utilizador. Atualiza e tenta novamente.');
      throw new Error('Supabase: não foi possível aceder ao catálogo (HTTP ' + response.status + '). Verifica a configuração e executa supabase/catalog.sql.');
    }
    return response.status === 204 ? null : response.json();
  }
  async function read() {
    if (mode === 'supabase') {
      const rows = await request('app_catalog?id=eq.main&select=data,revision');
      if (!rows.length) throw new Error('Catálogo ainda não importado. Executa npm run migrate:supabase.');
      validateCatalog(rows[0].data);
      return rows[0];
    }
    if (fs.existsSync(file)) {
      const row = JSON.parse(fs.readFileSync(file, 'utf8'));
      validateCatalog(row.data);
      return row;
    }
    return { data: validateCatalog(JSON.parse(fs.readFileSync(seed, 'utf8'))), revision: 0 };
  }
  async function save(data, revision) {
    validateCatalog(data);
    if (mode === 'supabase') {
      const rows = await request('app_catalog?id=eq.main&revision=eq.' + revision, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ data, revision: revision + 1, updated_at: new Date().toISOString() })
      });
      if (!rows.length) throw new Error('O catálogo foi alterado por outro utilizador. Atualiza e tenta novamente.');
      return rows[0];
    }
    const current = await read();
    if (current.revision !== revision) throw new Error('O catálogo foi alterado. Atualiza e tenta novamente.');
    const row = {data, revision: revision + 1};
    fs.mkdirSync(path.dirname(file), {recursive:true});
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(row, null, 2));
    fs.renameSync(temporary, file);
    return row;
  }
  async function importSeed(data) {
    validateCatalog(data);
    if (mode !== 'supabase') throw new Error('A importação requer Supabase configurado.');
    return request('app_catalog', {method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify({id:'main', data, revision:1})});
  }
  return { mode, read, save, importSeed };
}
module.exports = { createCatalogStore, validateCatalog };
