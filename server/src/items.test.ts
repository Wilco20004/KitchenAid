import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway database: set before the modules below open it.
process.env.KITCHENAID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchenaid-test-'));

const load = async () => ({
  items: await import('./items'),
  recipes: await import('./recipes'),
  costing: await import('./costing'),
  shopping: await import('./shopping'),
  db: (await import('./db')).db,
});

test('pack price → unit price per item, per g, per ml', async () => {
  const { items } = await load();
  const eggs = items.ensureItem('Eggs');
  assert.equal(items.setPackPrice(eggs.id, 72, 'PNP EXTRA LARGE EGGS 18S', 'slip').unit_price, 4);
  assert.equal(items.getItem(eggs.id)!.price_unit, 'item');
  const mince = items.ensureItem('Beef mince');
  const m = items.setPackPrice(mince.id, 150, 'BEEF MINCE 1.2KG', 'slip');
  assert.equal(m.price_unit, 'g');
  assert.equal(m.unit_price, 0.125);
  const milk = items.ensureItem('Milk');
  const mk = items.setPackPrice(milk.id, 40, 'FULL CREAM MILK 2L', 'slip');
  assert.deepEqual([mk.price_unit, mk.unit_price], ['ml', 0.02]);
});

test('slip lines find the item you already have, and remember the spelling', async () => {
  const { items } = await load();
  const milk = items.findItem({ name: 'Milk' })!;
  items.ensureItem('Cream'); // "full CREAM milk" must still be milk
  assert.equal(items.itemForSlipLine('PNP FRESH FULL CREAM MILK 2L').id, milk.id);
  // A new thing becomes a tidy new item…
  const soup = items.itemForSlipLine('KNORR BRN ONION SOUP 50G');
  assert.equal(soup.name, 'Knorr Brn Onion Soup');
  assert.equal(items.itemForSlipLine('PNP EXTRA LARGE EGGS 18S').name, 'Eggs');
  // …and the spelling is remembered, so the next slip finds the same item.
  const again = items.itemForSlipLine('KNORR BRN ONION SOUP 50G');
  assert.equal(again.id, soup.id);
});

test('two brands, two barcodes, one item — and merging moves everything', async () => {
  const { items, shopping, db } = await load();
  const soup = items.ensureItem('Brown onion soup');
  items.addAlias(soup.id, 'barcode', '6001087340281', 'Knorr Brown Onion Soup');
  const royco = items.ensureItem('Royco onion soup');
  items.addAlias(royco.id, 'barcode', '6001038205019', 'Royco Brown Onion Soup');
  const list = (db.prepare('SELECT id FROM shopping_lists LIMIT 1').get() as { id: string }).id;
  shopping.addItem(list, { name: 'Royco onion soup', quantity: 2, unit: null });

  items.mergeItems(royco.id, soup.id);
  assert.equal(items.findItem({ barcode: '6001038205019' })!.id, soup.id);
  assert.equal(items.findItem({ name: 'Royco onion soup' })!.id, soup.id);
  // Adding the old name again tops up the same shopping line.
  const row = shopping.addItem(list, { name: 'Royco onion soup', quantity: 1, unit: null });
  assert.equal(row.quantity, 3);
  assert.throws(() => items.addAlias(royco.id, 'barcode', '1'), /not found|FOREIGN|constraint/i);
});

test('recipe cost uses only the amount needed: 2 eggs at R4 = R8', async () => {
  const { recipes, costing } = await load();
  const id = recipes.saveRecipe(
    {
      name: 'Scramble',
      servings: 2,
      ingredients: [
        { section: null, raw: '2 eggs' },
        { section: null, raw: '125 ml milk' },
        { section: null, raw: '250 g beef mince' },
        { section: null, raw: 'salt to taste' },
        { section: null, raw: '1 tbsp saffron' },
      ],
    },
    null
  );
  const c = await costing.recipeCost(id);
  const by = Object.fromEntries(c.lines.map((l) => [l.raw, l.cost]));
  assert.equal(by['2 eggs'], 8);
  assert.equal(by['125 ml milk'], 2.5);
  assert.equal(by['250 g beef mince'], 31.25);
  assert.equal(by['salt to taste'], null);
  assert.equal(by['1 tbsp saffron'], null);
  assert.equal(c.total, 41.75);
  assert.equal(c.per_serving, 20.88);
  // Double the servings, double the eggs.
  const doubled = await costing.recipeCost(id, 4);
  assert.equal(doubled.lines[0].cost, 16);
});

test('pantry covers recipe ingredients by words', async () => {
  const { items } = await load();
  items.addToPantry({ name: 'Full cream milk' });
  const keys = items.pantryKeys();
  assert.ok(items.pantryCovers('milk', keys));
  assert.ok(!items.pantryCovers('chicken breast', keys));
});

test('price matching skips kitchenware unless it was asked for', async () => {
  const { isKitchenware } = await import('./prices/basket');
  assert.ok(isKitchenware('Quirky Online Plastic Egg Container - 30 Unit', 'eggs'));
  assert.ok(isKitchenware('Bamboo Egg Holder Rack', 'eggs'));
  assert.ok(!isKitchenware('Eggs for Africa Medium Eggs 18 Pack', 'eggs'));
  assert.ok(!isKitchenware('Addis Food Container 2L', 'food container'));
  assert.ok(!isKitchenware('Black Pepper Grinder', 'pepper grinder'));
});

test('prices paid per shop: tidy shop names, latest per shop, whole packs for a list', async () => {
  const { items } = await load();
  const { paidPricesFor } = await import('./paid');
  assert.equal(items.storeName('SHOPRITE CHECKERS HYPER MENLYN'), 'Checkers');
  assert.equal(items.storeName('KWIKSPAR MAIN ROAD'), 'SPAR');
  assert.equal(items.storeName('Pick n Pay Family'), 'Pick n Pay');

  const rice = items.ensureItem('Rice');
  items.setPackPrice(rice.id, 60, 'TASTIC RICE 2KG', 'slip', '2026-08-01', { store: 'Checkers', historyOnly: true });
  items.setPackPrice(rice.id, 55, 'TASTIC RICE 2KG', 'slip', '2026-09-01', { store: 'Checkers', historyOnly: true });
  items.setPackPrice(rice.id, 70, 'SPAR RICE 2KG', 'slip', '2026-09-10', { store: 'SPAR', historyOnly: true });
  // An older slip arriving late doesn't overwrite the newer "last price".
  items.setPackPrice(rice.id, 40, 'RICE 2KG', 'slip', '2026-01-01', { store: 'Boxer', historyOnly: true });
  assert.equal(items.getItem(rice.id)!.pack_price, 70);

  const latest = items.latestPricesByStore(rice.id);
  assert.deepEqual(latest.map((p) => [p.store, p.pack_price]), [['SPAR', 70], ['Checkers', 55], ['Boxer', 40]]);

  const r = paidPricesFor([{ item_id: rice.id, name: 'Rice', quantity: 3, unit: 'kg' }]);
  const checkers = r.items[0].prices.find((p) => p.store === 'Checkers')!;
  assert.deepEqual([checkers.packs, checkers.cost], [2, 110]);
  assert.equal(r.stores[0].store, 'Boxer'); // cheapest when coverage is equal
});

test('a plain count of something sold by weight means that many packs', async () => {
  const { packsFor } = await import('./paid');
  const soup = { store: 'SPAR', pack_price: 12.99, pack_label: 'KNORR BRN ONION SOUP 50G', unit_price: 0.2598, price_unit: 'g' as const, seen_at: '2026-09-01', source: 'slip' };
  assert.deepEqual(packsFor(soup, { name: 'onion soup', quantity: 2, unit: null }), { packs: 2, cost: 25.98 });
  assert.deepEqual(packsFor(soup, { name: 'onion soup', quantity: 120, unit: 'g' }), { packs: 3, cost: 38.97 });
});
