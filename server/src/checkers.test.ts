import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Set before anything loads the data path: the Checkers adapter keeps its
// credit counts in the settings table.
process.env.KITCHENAID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchenaid-test-'));
// Add-on options are read once when the price modules load, so write them first.
fs.writeFileSync(
  path.join(process.env.KITCHENAID_DATA_DIR, 'options.json'),
  JSON.stringify({ parse_api_key: 'test', checkers_daily_searches: 3, checkers_monthly_credits: 300, checkers_requests_per_minute: 500 })
);

test('checkers (via Parse): cents to rand, promotions, stock, both response shapes', async () => {
  const { parseCheckers } = await import('./prices/stores/checkers');
  const product = {
    id: '10136729EA',
    name: 'Clover Fresh Full Cream Milk 2L',
    priceWithoutDecimal: 3699,
    currency: 'ZAR',
    isStockAvailable: true,
    isOnPromotion: true,
    image: '65f0c0ffee',
  };
  const wrapped = parseCheckers({ data: { products: [product, { id: 'x', name: 'No price' }], totalCount: 2 }, status: 'success' });
  assert.equal(wrapped.length, 1);
  assert.deepEqual(
    [wrapped[0].storeProductId, wrapped[0].price, wrapped[0].inStock, wrapped[0].promo, wrapped[0].imageUrl],
    ['10136729EA', 36.99, true, 'On promotion', null]
  );
  assert.equal(parseCheckers({ products: [product] })[0].price, 36.99);
  assert.deepEqual(parseCheckers({}), []);
});

test('daily broad searches: picks terms from the list, stops at the daily cap, then matches locally for free', async (t) => {
  const http = await import('http');
  // Stand-in for Parse: counts calls, returns a page of products for the query.
  let calls = 0;
  const catalogue: Record<string, { name: string; cents: number }[]> = {
    milk: [{ name: 'Clover Full Cream Milk 2L', cents: 3699 }, { name: 'Checkers Housebrand Low Fat Milk 1L', cents: 1899 }],
    eggs: [{ name: 'Checkers Large Eggs 18 Pack', cents: 6599 }, { name: 'Nulaid Free Range Eggs 6', cents: 3299 }],
    'onion soup': [{ name: 'Knorr Brown Onion Soup 50g', cents: 1299 }],
    rice: [{ name: 'Tastic Rice 2kg', cents: 5499 }],
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c)).on('end', () => {
      calls++;
      const q = JSON.parse(body).query as string;
      const products = (catalogue[q] ?? []).map((p, i) => ({ id: `${q}-${i}`, name: p.name, priceWithoutDecimal: p.cents, isStockAvailable: true }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { products, totalCount: products.length }, status: 'success' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.PARSE_CHECKERS_URL = `http://127.0.0.1:${(server.address() as any).port}/search_products`;
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const { db } = await import('./db');
  const { addItem } = await import('./shopping');
  const { runCheckersDaily, broadTerm } = await import('./prices/checkersDaily');
  const { search } = await import('./prices/search');
  const { checkersCreditsToday } = await import('./prices/stores/checkers');

  assert.equal(broadTerm('Clover Full Cream Milk'), 'milk');
  assert.equal(broadTerm('Knorr Brown Onion Soup'), 'onion soup');
  assert.equal(broadTerm('2 dozen Eggs'), 'eggs');

  const list = (db.prepare('SELECT id FROM shopping_lists LIMIT 1').get() as { id: string }).id;
  for (const name of ['Milk', 'Eggs', 'Brown onion soup', 'Rice', 'Bread']) addItem(list, { name });

  const first = await runCheckersDaily();
  assert.deepEqual(first.searched.map((s) => s.term), ['milk', 'eggs', 'onion soup']);
  assert.equal(calls, 3);
  assert.equal(checkersCreditsToday(), 3);

  // Budget spent: another run does nothing.
  const second = await runCheckersDaily();
  assert.equal(second.searched.length, 0);
  assert.equal(calls, 3);

  // Searching now answers Checkers from the stored catalogue — no new calls.
  const eggs = await search('eggs', { stores: ['checkers'] });
  assert.deepEqual(eggs.products.map((p) => [p.name, p.price]), [
    ['Nulaid Free Range Eggs 6', 32.99],
    ['Checkers Large Eggs 18 Pack', 65.99],
  ]);
  assert.equal(calls, 3);
});
