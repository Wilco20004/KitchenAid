import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway database: set before the modules below open it.
process.env.KITCHENAID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchenaid-test-'));

test('item size: "1 packet" of lemon juice becomes 1 bottle of 750 ml, and cooking takes millilitres off', async () => {
  const items = await import('./items');
  const { useFromPantry, parseAmount } = await import('./cooking');
  const { guessPack } = await import('./slips');

  // As an old slip left it.
  const juice = items.addToPantry({ name: 'Lemon juice', quantity: 1, unit: 'packet' });
  let j = items.setItemSize(juice.id, { container: 'bottle', size_quantity: 750, size_unit: 'ml' });
  assert.equal(j.pantry_unit, 'bottle'); // recounted in the new container
  assert.equal(j.pantry_quantity, 1);

  // 2 tbsp out of the bottle leaves 720 ml.
  const r = useFromPantry(juice.id, { amount: parseAmount('2 tbsp') });
  assert.equal(r.removed, false);
  j = items.getItem(juice.id)!;
  assert.deepEqual([j.pantry_quantity, j.pantry_unit], [720, 'ml']);

  // Fixing the count by hand.
  j = items.setPantryAmount(juice.id, { quantity: 2, unit: 'bottle' });
  assert.deepEqual([j.pantry_quantity, j.pantry_unit], [2, 'bottle']);

  // A slip line that doesn't say the size defaults to the item's.
  assert.deepEqual(guessPack('JUICE LEMON', juice.id, 1), { quantity: 750, unit: 'ml', from: 'remembered' });

  // Only known containers and sensible size units.
  assert.throws(() => items.setItemSize(juice.id, { container: 'bucket' }), /isn't a container/);
  assert.throws(() => items.setItemSize(juice.id, { size_quantity: 1, size_unit: 'cup' }), /g, kg, ml, l or pieces/);
  // Clearing the size leaves the container.
  j = items.setItemSize(juice.id, { size_quantity: null });
  assert.deepEqual([j.container, j.size_quantity, j.size_unit], ['bottle', null, null]);
});
