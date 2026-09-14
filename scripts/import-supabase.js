const fs = require('fs');
const path = require('path');
const { createCatalogStore } = require('../src/catalog-store');
const envFile = path.join(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}
async function main() {
  const local = path.join(__dirname, '../data/catalog-local.json');
  const data = fs.existsSync(local)
    ? JSON.parse(fs.readFileSync(local, 'utf8')).data
    : JSON.parse(fs.readFileSync(path.join(__dirname, '../data/catalog-seed.json'), 'utf8'));
  const store = createCatalogStore({ mode:'supabase', url:process.env.SUPABASE_URL, key:process.env.SUPABASE_SERVICE_ROLE_KEY });
  await store.importSeed(data); // INSERT only: never overwrites an existing catalogue.
  const saved = await store.read();
  const assert = require('node:assert/strict');
  assert.deepEqual(saved.data, data);
  console.log('Catalogo separado importado e verificado. Configura CATALOG_STORAGE=supabase e reinicia a aplicacao.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
