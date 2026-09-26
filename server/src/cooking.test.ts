import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway database: set before the modules below open it.
process.env.KITCHENAID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchenaid-test-'));

test('cooking a recipe takes its ingredients out of the pantry', async () => {
  const items = await import('./items');
  const { saveRecipe } = await import('./recipes');
  const { cookPlan, applyUse, pantryItemFor } = await import('./cooking');

  const mince = items.addToPantry({ name: 'Beef Mince', quantity: 1, unit: 'kg' });
  const paste = items.addToPantry({ name: 'Tomato Paste', quantity: 50, unit: 'g' });
  const garlic = items.addToPantry({ name: 'Garlic Clove' });
  items.addToPantry({ name: 'Milk', quantity: 1, unit: 'l' });
  const id = saveRecipe(
    {
      name: 'Mince',
      servings: 4,
      ingredients: ['500 g beef mince', '50 g tomato paste', '2 garlic cloves', '400 ml coconut milk', '1 tsp salt'].map((raw) => ({ section: null, raw })),
    },
    null
  );

  // "coconut milk" must not come out of the Milk.
  assert.equal(pantryItemFor('coconut milk'), undefined);

  const plan = cookPlan(id);
  const byItem = Object.fromEntries(plan.lines.map((l) => [l.item, l]));
  assert.deepEqual(Object.keys(byItem).sort(), ['Beef Mince', 'Garlic Clove', 'Tomato Paste']);
  assert.equal(byItem['Beef Mince'].action, 'subtract');
  assert.equal(byItem['Beef Mince'].left_text, '500 g');
  assert.equal(byItem['Tomato Paste'].action, 'use_up');
  assert.equal(byItem['Garlic Clove'].action, 'unknown');
  assert.ok(plan.not_at_home.includes('400 ml coconut milk'));

  // Doubled servings: the whole kilo goes.
  assert.equal(cookPlan(id, 8).lines.find((l) => l.item === 'Beef Mince')!.action, 'use_up');

  const results = applyUse([
    { item_id: mince.id, amount: '500 g' },
    { item_id: paste.id, amount: '50 g', used_up: true },
    { item_id: garlic.id, amount: null }, // no amount at home, not ticked: stays
  ]);
  assert.equal(results[0].left, '500 g');
  const m = items.getItem(mince.id)!;
  assert.deepEqual([m.in_pantry, m.pantry_quantity, m.pantry_unit], [1, 500, 'g']);
  assert.equal(items.getItem(paste.id)!.in_pantry, 0);
  assert.equal(items.getItem(garlic.id)!.in_pantry, 1);
});

test('use some: counts, weights, and what can\'t be taken off', async () => {
  const items = await import('./items');
  const { useFromPantry, parseAmount } = await import('./cooking');
  const hake = items.addToPantry({ name: 'Hake medallions', quantity: 8 });
  assert.equal(useFromPantry(hake.id, { amount: parseAmount('2') }).left, '6');
  assert.equal(useFromPantry(hake.id, { amount: parseAmount('6') }).removed, true);
  assert.equal(items.getItem(hake.id)!.in_pantry, 0);

  const bacon = items.addToPantry({ name: 'Streaky bacon', quantity: 1, unit: 'packet' });
  const r = useFromPantry(bacon.id, { amount: parseAmount('100 g') });
  assert.equal(r.removed, false);
  assert.match(r.skipped!, /can't take/);
  assert.equal(useFromPantry(bacon.id, { usedUp: true }).removed, true);
});

test('packs: sachets and tins come off one at a time, part packs drop to what is inside', async () => {
  const { subtractAmounts, addPantryAmounts, packContents } = await import('./amounts');
  const { formatAmount } = await import('./ingredients');
  const left = (have: any, use: any, label: string | null) => {
    const r = subtractAmounts(have, use, 'x', packContents(label));
    return r ? formatAmount(r.left) : null;
  };
  // 4 sachets of MIAMI 50G, recipe uses 50 g → 3 sachets.
  assert.equal(left({ quantity: 4, unit: 'packet' }, { quantity: 50, unit: 'g' }, 'MIAMI 50G'), '3 packet');
  // 3 tins, recipe uses 1 tin (label says nothing about size).
  assert.equal(left({ quantity: 3, unit: 'packet' }, { quantity: 1, unit: 'tin' }, 'CHOPPED TOMATOES'), '2 packet');
  // 1 packet of 500 g mince, 300 g used → 200 g.
  assert.equal(left({ quantity: 1, unit: 'packet' }, { quantity: 300, unit: 'g' }, 'BEEF MINCE 500G'), '200 g');
  // A tray of 18 eggs, 2 used → 16.
  assert.equal(left({ quantity: 1, unit: 'packet' }, { quantity: 2, unit: null }, 'EGGS 18S'), '16');
  // 1 kg at home, a 500 g packet used.
  assert.equal(left({ quantity: 1, unit: 'kg' }, { quantity: 1, unit: 'packet' }, 'Beef mince 500g'), '500 g');
  // Sizes unknown and units that don't meet: can't say.
  assert.equal(left({ quantity: 1, unit: 'packet' }, { quantity: 100, unit: 'g' }, 'SAFARI VINEGAR'), null);

  // Buying more: 1 kg + 2 packets of 500 g = 2 kg; 4 sachets + 2 packs = 6.
  assert.equal(formatAmount(addPantryAmounts({ quantity: 1, unit: 'kg' }, { quantity: 2, unit: 'packet' }, 'mince', packContents('BEEF MINCE 500G'))!), '2 kg');
  assert.equal(formatAmount(addPantryAmounts({ quantity: 4, unit: 'sachet' }, { quantity: 2, unit: 'packet' }, 'paste', null)!), '6 sachet');
});

test('slips put the number of packs bought in the pantry', async () => {
  const items = await import('./items');
  const paste = items.addToPantry({ name: 'Tomato paste sachet', quantity: 4, unit: 'packet', pack_label: 'MIAMI 50G', source: 'budgetpro' });
  assert.deepEqual([paste.pantry_quantity, paste.pantry_unit], [4, 'packet']);
  const more = items.addToPantry({ itemId: paste.id, quantity: 2, unit: 'packet', pack_label: 'MIAMI 50G', source: 'budgetpro' });
  assert.equal(more.pantry_quantity, 6);
});
