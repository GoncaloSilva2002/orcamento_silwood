const fs = require('fs');
const path = require('path');

const CATEGORIES = [
  'plates',
  'paintings',
  'doorSystems',
  'hinges',
  'hingeComponents',
  'openingSystemComponents',
  'edges',
  'extras',
  'paintingComponents',
  'paintingMixDetails',
  'paintRecipes',
  'drawerComponents',
  'drawerRecipes'
];

const CATEGORY_TABLES = {
  plates: 'catalog_plates',
  paintings: 'catalog_paintings',
  doorSystems: 'catalog_door_systems',
  hinges: 'catalog_hinges',
  hingeComponents: 'catalog_hinge_components',
  openingSystemComponents: 'catalog_opening_system_components',
  edges: 'catalog_edges',
  extras: 'catalog_extras',
  paintingComponents: 'catalog_painting_components',
  paintingMixDetails: 'catalog_painting_mix_details',
  paintRecipes: 'catalog_paint_recipes',
  drawerComponents: 'catalog_drawer_components',
  drawerRecipes: 'catalog_drawer_recipes'
};

function validateCatalog(data) {
  if (!data || data.schemaVersion !== 1 || !data.catalog || !data.lists || !data.typePresets || !data.feetPrices) {
    throw new Error('Catalogo invalido ou versao nao suportada.');
  }
  for (const key of CATEGORIES) {
    if (!Array.isArray(data.catalog[key])) throw new Error('Categoria invalida: ' + key);
  }
  return data;
}

function itemKey(category, item, index) {
  const candidates = [
    item && item.priceKey,
    item && item.key,
    item && item.id,
    item && item.name,
    item && item.item,
    item && item.label,
    item && item.reference
  ].filter(value => value !== undefined && value !== null && String(value).trim());
  return category + ':' + String(index).padStart(6, '0') + ':' + (candidates[0] ? String(candidates[0]) : 'row');
}

function buildRows(data, category) {
  return data.catalog[category].map((item, index) => ({
    item_key: itemKey(category, item, index),
    item_order: index,
    data: item
  }));
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
      if (response.status === 409) throw new Error('O catalogo foi alterado por outro utilizador. Atualiza e tenta novamente.');
      throw new Error('Supabase: nao foi possivel aceder ao catalogo (HTTP ' + response.status + '). Verifica a configuracao e executa supabase/catalog.sql.');
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function readSupabaseMaterials() {
    const metaRows = await request('app_catalog_meta?id=eq.main&select=lists,type_presets,feet_prices,revision');
    if (!metaRows.length) throw new Error('Catalogo ainda nao importado. Executa npm run migrate:supabase.');
    const data = {
      schemaVersion: 1,
      catalog: {},
      lists: metaRows[0].lists,
      typePresets: metaRows[0].type_presets,
      feetPrices: metaRows[0].feet_prices
    };
    const categoryRows = await Promise.all(CATEGORIES.map(category =>
      request(CATEGORY_TABLES[category] + '?select=data&order=item_order.asc')
    ));
    CATEGORIES.forEach((category, index) => {
      data.catalog[category] = categoryRows[index].map(row => row.data);
    });
    return { data: validateCatalog(data), revision: metaRows[0].revision };
  }

  async function read() {
    if (mode === 'supabase') return readSupabaseMaterials();
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
      const current = await request('app_catalog_meta?id=eq.main&revision=eq.' + revision + '&select=revision');
      if (!current.length) throw new Error('O catalogo foi alterado por outro utilizador. Atualiza e tenta novamente.');
      for (const table of Object.values(CATEGORY_TABLES)) await request(table + '?item_key=not.is.null', { method: 'DELETE' });
      for (const category of CATEGORIES) {
        const rows = buildRows(data, category);
        if (rows.length) {
          await request(CATEGORY_TABLES[category], {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(rows)
          });
        }
      }
      const rows = await request('app_catalog_meta?id=eq.main&revision=eq.' + revision, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          lists: data.lists,
          type_presets: data.typePresets,
          feet_prices: data.feetPrices,
          revision: revision + 1,
          updated_at: new Date().toISOString()
        })
      });
      if (!rows.length) throw new Error('O catalogo foi alterado por outro utilizador. Atualiza e tenta novamente.');
      return { data, revision: rows[0].revision };
    }
    const current = await read();
    if (current.revision !== revision) throw new Error('O catalogo foi alterado. Atualiza e tenta novamente.');
    const row = { data, revision: revision + 1 };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(row, null, 2));
    fs.renameSync(temporary, file);
    return row;
  }

  async function importSeed(data) {
    validateCatalog(data);
    if (mode !== 'supabase') throw new Error('A importacao requer Supabase configurado.');
    const existing = await request('app_catalog_meta?id=eq.main&select=revision');
    if (existing.length) return save(data, existing[0].revision);
    await request('app_catalog_meta', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ id: 'main', lists: data.lists, type_presets: data.typePresets, feet_prices: data.feetPrices, revision: 1 })
    });
    for (const category of CATEGORIES) {
      const rows = buildRows(data, category);
      if (rows.length) {
        await request(CATEGORY_TABLES[category], {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(rows)
        });
      }
    }
    return readSupabaseMaterials();
  }

  return { mode, read, save, importSeed };
}

module.exports = { createCatalogStore, validateCatalog, CATEGORIES, CATEGORY_TABLES };
