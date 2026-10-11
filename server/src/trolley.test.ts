import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway database: set before the modules below open it.
process.env.KITCHENAID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchenaid-test-'));

test('trolley: clearing only empties it — the pantry fills from slips and by hand, never from the list', async () => {
  const { db } = await import('./db');
  const { addItem } = await import('./shopping');
  const { shoppingRouter } = await import('./routes/shopping');
  const items = await import('./items');
  const express = (await import('express')).default;
  const app = express().use(express.json()).use('/api/shopping', shoppingRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/shopping`;
  try {
    const list = (db.prepare('SELECT id FROM shopping_lists LIMIT 1').get() as { id: string }).id;
    const jam = addItem(list, { name: 'Jam' });
    addItem(list, { name: 'Rusks' });
    await fetch(`${base}/items/${jam.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checked: true }) });

    const r = await fetch(`${base}/lists/${list}/clear-checked`, { method: 'POST' }).then((x) => x.json());
    assert.deepEqual(r, { removed: 1 });
    assert.notEqual(items.findItem({ name: 'Jam' })?.in_pantry, 1);
    // What wasn't ticked stays on the list.
    assert.deepEqual((db.prepare('SELECT name FROM shopping_items WHERE list_id = ?').all(list) as { name: string }[]).map((i) => i.name), ['Rusks']);
  } finally {
    server.close();
  }
});
