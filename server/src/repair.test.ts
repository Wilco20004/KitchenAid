import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway database: set before the modules below open it.
process.env.KITCHENAID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchenaid-test-'));

test('product forms: chips, energy bars, dog food and baby food are different things', async () => {
  const { differentProduct } = await import('./productForms');
  assert.equal(differentProduct('potato', 'Willards Crinkle Cut Open Fire Chops Flavoured Potato Chips 120g'), true);
  assert.equal(differentProduct('butter', 'Jungle Peanut Butter Energy Bar 47g'), true);
  assert.equal(differentProduct('beef mince', 'Husky Mince Beef Flavour Beef 775 g Wet Adult Dog Food'), true);
  assert.equal(differentProduct('lamb stew', 'Boss Mighty Chunks Lamb Stew 775g'), true);
  assert.equal(differentProduct('sweet potato', 'Purity Jar Sweet Potato 125ml from 6 Months'), true);
  assert.equal(differentProduct('garlic', "Pot O' Gold Tomato Paste With Garlic 50g"), true);
  assert.equal(differentProduct('tomato paste', 'Blue Crane Tomato Paste 50g'), false);
  assert.equal(differentProduct('milk', 'Dewfresh Full Cream Fresh Milk 1L'), false);
  assert.equal(differentProduct('egg', 'Farmhouse Eggs Extra Large Eggs Tray 30 Pack'), false);
  assert.equal(differentProduct('beef stock cubes', 'Knorr Beef Stock Cubes 24s'), false);
});

test('shop matching: whole words only, no pet food, plain onions before spring onions', async () => {
  const { hasWords } = await import('./prices/basket');
  assert.equal(hasWords(['rice'], 'Pietro Coricelli Extra Virgin Olive Oil 750ml'), false);
  assert.equal(hasWords(['rice'], 'Tastic Rice 2kg'), true);
  assert.equal(hasWords(['potato'], 'PnP Potatoes 2kg'), true);
  assert.equal(hasWords(['chicken', 'fillet'], 'Chicken Breast Fillets 1kg'), true);
});

test('slip lines never land on a different kind of product', async () => {
  const { ensureItem, itemForSlipLine } = await import('./items');
  const potato = ensureItem('Potato');
  const butter = ensureItem('Butter');
  assert.notEqual(itemForSlipLine('Willards Crinkle Cut Potato Chips 120g').id, potato.id);
  assert.notEqual(itemForSlipLine('Jungle Peanut Butter Energy Bar 47g').id, butter.id);
  assert.equal(itemForSlipLine('PNP POTATOES 2KG').id, potato.id);
  assert.equal(itemForSlipLine('Clover Salted Butter 500g').id, butter.id);
});

test('repair: drops misread-slip prices and junk items, moves wrongly linked slip lines', async () => {
  const { db } = await import('./db');
  const items = await import('./items');
  const { repairSlipData } = await import('./repair');

  // What 0.4.0 could leave behind: a wrong link with its price…
  const milk = items.ensureItem('Milk');
  items.addAlias(milk.id, 'slip', 'BAR-ONE Mega Milk Chocolate Bar 84g', 'BAR-ONE Mega Milk Chocolate Bar 84g');
  items.setPackPrice(milk.id, 19.99, 'Dewfresh Full Cream Fresh Milk 1L', 'slip', '2026-09-04', { store: 'Checkers' });
  items.setPackPrice(milk.id, 21.99, 'BAR-ONE Mega Milk Chocolate Bar 84g', 'slip', '2026-09-10', { store: 'Checkers' });
  // …and a misread slip dated 2038 that made its own items and put them in the pantry.
  const junk = items.ensureItem('Qoft Ens Och');
  items.addAlias(junk.id, 'slip', 'QOFT ENS OCH', 'QOFT ENS OCH');
  items.setPackPrice(junk.id, 5333.99, 'QOFT ENS OCH', 'slip', '2038-08-28', { store: 'SPAR' });
  items.addToPantry({ itemId: junk.id, source: 'budgetpro', bought_at: '2038-08-28' });
  // A real item that a misread line also matched keeps itself, just loses that price.
  const rolls = items.ensureItem('Rolls');
  items.setPackPrice(rolls.id, 20, "S/B ROLLS 6'S", 'slip', '2026-09-25', { store: 'SPAR' });
  items.setPackPrice(rolls.id, 924.33, 'DECANT 300C XE', 'slip', '2038-08-28', { store: 'SPAR' });
  items.addToPantry({ itemId: rolls.id, source: 'budgetpro', bought_at: '2038-08-28' });

  const report = repairSlipData();
  assert.equal(report.badPrices, 2);
  assert.deepEqual(report.deleted, ['Qoft Ens Och']);
  assert.equal(report.relinked.length, 1);
  assert.equal(report.relinked[0].from, 'Milk');

  assert.equal(items.getItem(junk.id), undefined);
  const m = items.getItem(milk.id)!;
  assert.deepEqual([m.pack_price, m.pack_label], [19.99, 'Dewfresh Full Cream Fresh Milk 1L']);
  const barId = (db.prepare("SELECT item_id FROM item_prices WHERE pack_label LIKE 'BAR-ONE%'").get() as { item_id: string }).item_id;
  assert.notEqual(barId, milk.id);
  assert.equal(items.getItem(barId)!.pack_price, 21.99);
  const r = items.getItem(rolls.id)!;
  assert.deepEqual([r.pack_price, r.in_pantry], [20, 0]);
});
