// Read-only verification against the configured project using the real API routes.
const assert = require('node:assert/strict');
const { app } = require('../src/server');
const seed = require('../data/catalog-seed.json');
const { CATEGORIES } = require('../src/catalog-store');

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/api/bootstrap');
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    assert.equal(data.source.storage, 'supabase');
    for (const category of CATEGORIES) {
      assert.equal(data.catalog[category].length, seed.catalog[category].length, category);
    }
    const calculated = await fetch(base + '/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    assert.equal(calculated.status, 200);
    const quote = await calculated.json();
    assert.ok(Number.isFinite(quote.totals.finalTotal));
    console.log('Supabase verificado: catalogo separado completo e orcamento calculado pelas rotas da aplicacao.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
