import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway database: set before the modules below open it.
process.env.KITCHENAID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchenaid-test-'));

test('slip review: butter bricks are remembered, for the spelling and for the item', async () => {
  const items = await import('./items');
  const slips = await import('./slips');

  // A slip arrives: 2 × BONNITA BUTTER at R59.99, linked to Butter.
  const butter = items.itemForSlipLine('BONNITA BUTTER');
  items.setPackPrice(butter.id, 59.99, 'BONNITA BUTTER', 'slip', '2026-09-26', { store: 'Checkers', historyOnly: true });
  assert.equal(items.getItem(butter.id)!.price_unit, 'item'); // no size on the label yet
  slips.queueSlipLines('r1', 'Checkers', '2026-09-26', [{ raw_name: 'BONNITA BUTTER', quantity: 2, amount: 119.98, item_id: butter.id }]);
  assert.equal(items.getItem(butter.id)!.in_pantry, 0); // waits for review

  let [slip] = slips.pendingSlips();
  let line: any = slip.lines[0];
  assert.deepEqual(line.pack, { quantity: 1, unit: 'packet', from: 'guess' });

  // "It's a 500 g brick."
  slips.acceptSlipLines([{ id: line.id, pack_quantity: 500, pack_unit: 'g' }]);
  let b = items.getItem(butter.id)!;
  assert.deepEqual([b.in_pantry, b.pantry_quantity, b.pantry_unit], [1, 1000, 'g']);
  // …and its price is now per gram.
  assert.equal(b.price_unit, 'g');
  assert.ok(Math.abs(b.unit_price! - 59.99 / 500) < 1e-9);
  assert.equal(slips.pendingCount(), 0);

  // Same spelling next time: filled in.
  slips.queueSlipLines('r2', 'Checkers', '2026-10-03', [{ raw_name: 'BONNITA BUTTER', quantity: 1, amount: 59.99, item_id: butter.id }]);
  [slip] = slips.pendingSlips();
  line = slip.lines[0];
  assert.equal(line.pack.from, 'remembered');
  assert.deepEqual([line.pack.quantity, line.pack.unit], [500, 'g']);

  // A different brand linked to Butter: the item's usual brick.
  assert.equal(slips.guessPack('CLOVER BUTTER', butter.id, 1).quantity, 500);
  // …unless its label says otherwise.
  assert.deepEqual(slips.guessPack('CLOVER BUTTER 250G', butter.id, 1), { quantity: 250, unit: 'g', from: 'label' });

  slips.acceptSlipLines([{ id: line.id }]);
  assert.equal(items.getItem(butter.id)!.pantry_quantity, 1500);
});

test('slip review: renaming a made-up item, tins, pieces and skipping', async () => {
  const items = await import('./items');
  const slips = await import('./slips');

  const corn = items.itemForSlipLine('SWTCORN WHL 410G');
  const cubes = items.itemForSlipLine('KNORRX CHIC 24S');
  const bag = items.itemForSlipLine('CHECKERS BAG');
  slips.queueSlipLines('r3', 'Checkers', '2026-09-26', [
    { raw_name: 'SWTCORN WHL 410G', quantity: 1, amount: 21.99, item_id: corn.id },
    { raw_name: 'KNORRX CHIC 24S', quantity: 1, amount: 36.99, item_id: cubes.id },
    { raw_name: 'CHECKERS BAG', quantity: 1, amount: 1.5, item_id: bag.id },
  ]);
  const [slip] = slips.pendingSlips();
  const byRaw = Object.fromEntries(slip.lines.map((l: any) => [l.raw_name, l]));
  assert.deepEqual(byRaw['KNORRX CHIC 24S'].pack, { quantity: 24, unit: 'piece', from: 'label' });

  slips.acceptSlipLines([
    { id: byRaw['SWTCORN WHL 410G'].id, item_name: 'Sweetcorn', pack_quantity: 1, pack_unit: 'tin' },
    { id: byRaw['KNORRX CHIC 24S'].id, item_name: 'Chicken stock cubes' },
  ]);
  assert.equal(slips.skipSlipLines([byRaw['CHECKERS BAG'].id]), 1);

  // "Swtcorn Whl" was made just for that line, so it's renamed rather than left behind.
  const sweetcorn = items.getItem(corn.id)!;
  assert.equal(sweetcorn.name, 'Sweetcorn');
  assert.deepEqual([sweetcorn.pantry_quantity, sweetcorn.pantry_unit], [1, 'tin']);
  assert.equal(items.itemForSlipLine('SWTCORN WHL 410G').id, corn.id);
  const stock = items.findItem({ name: 'Chicken stock cubes' })!;
  assert.deepEqual([stock.pantry_quantity, stock.pantry_unit], [24, 'piece']);
  assert.equal(items.getItem(bag.id)!.in_pantry, 0);
  assert.equal(slips.pendingCount(), 0);
});

test('slip review: "1 sachet" keeps the per-gram price the label gives', async () => {
  const items = await import('./items');
  const slips = await import('./slips');
  const paste = items.itemForSlipLine('MIAMI 50G');
  items.setPackPrice(paste.id, 7.99, 'MIAMI 50G', 'slip', '2026-09-26');
  slips.queueSlipLines('r4', 'Checkers', '2026-09-26', [{ raw_name: 'MIAMI 50G', quantity: 4, amount: 31.96, item_id: paste.id }]);
  const line: any = slips.pendingSlips()[0].lines[0];
  slips.acceptSlipLines([{ id: line.id, pack_quantity: 1, pack_unit: 'sachet' }]);
  const p = items.getItem(paste.id)!;
  assert.deepEqual([p.pantry_quantity, p.pantry_unit, p.price_unit], [4, 'sachet', 'g']);
  assert.ok(Math.abs(p.unit_price! - 7.99 / 50) < 1e-9);
});
