import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db';
import { nameKey, parseIngredient } from '../ingredients';
import { addItem, NewItem, ShoppingItemRow } from '../shopping';
import { addToPantry, rememberItem } from '../items';

export const shoppingRouter = Router();

const listExists = (id: string) => Boolean(db.prepare('SELECT 1 FROM shopping_lists WHERE id = ?').get(id));
const itemOut = (i: ShoppingItemRow) => ({ ...i, checked: Boolean(i.checked) });

// ---------- lists ----------

shoppingRouter.get('/lists', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT l.*, (SELECT COUNT(*) FROM shopping_items i WHERE i.list_id = l.id AND i.checked = 0) AS open_count
         FROM shopping_lists l ORDER BY l.position, l.created_at`
      )
      .all()
  );
});

shoppingRouter.post('/lists', (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM shopping_lists').get() as { p: number }).p;
  const id = uuid();
  db.prepare('INSERT INTO shopping_lists (id, name, position, created_at) VALUES (?, ?, ?, ?)').run(id, name, position, new Date().toISOString());
  res.status(201).json(db.prepare('SELECT *, 0 AS open_count FROM shopping_lists WHERE id = ?').get(id));
});

shoppingRouter.put('/lists/:id', (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const r = db.prepare('UPDATE shopping_lists SET name = ? WHERE id = ?').run(name, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'List not found' });
  res.json(db.prepare('SELECT * FROM shopping_lists WHERE id = ?').get(req.params.id));
});

shoppingRouter.delete('/lists/:id', (req, res) => {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM shopping_lists').get() as { n: number }).n;
  if (count <= 1) return res.status(400).json({ error: "The last list can't be deleted" });
  const r = db.prepare('DELETE FROM shopping_lists WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'List not found' });
  res.status(204).end();
});

// ---------- items ----------

shoppingRouter.get('/lists/:id/items', (req, res) => {
  if (!listExists(req.params.id)) return res.status(404).json({ error: 'List not found' });
  const items = db
    .prepare('SELECT * FROM shopping_items WHERE list_id = ? ORDER BY checked, checked_at DESC, created_at')
    .all(req.params.id) as ShoppingItemRow[];
  res.json(items.map(itemOut));
});

// POST /api/shopping/lists/:id/items — { text: "2 kg potatoes" } or { name, quantity, unit, note, category_id }
shoppingRouter.post('/lists/:id/items', (req, res) => {
  if (!listExists(req.params.id)) return res.status(404).json({ error: 'List not found' });
  const body = req.body ?? {};
  let item: NewItem;
  if (typeof body.text === 'string') {
    if (!body.text.trim()) return res.status(400).json({ error: 'Type what you need' });
    const p = parseIngredient(body.text);
    item = { name: p.name, quantity: p.quantity, unit: p.unit, note: p.note };
  } else {
    if (!body.name?.trim()) return res.status(400).json({ error: 'name is required' });
    item = body;
  }
  res.status(201).json(itemOut(addItem(req.params.id, item)));
});

// POST /api/shopping/lists/:id/items/bulk { items: [{ name, quantity, unit, source }] } — from a recipe or the week's plan
shoppingRouter.post('/lists/:id/items/bulk', (req, res) => {
  if (!listExists(req.params.id)) return res.status(404).json({ error: 'List not found' });
  const items: NewItem[] = Array.isArray(req.body?.items) ? req.body.items.filter((i: NewItem) => i?.name?.trim()) : [];
  const added = db.transaction(() => items.map((i) => addItem(req.params.id, i)))();
  res.status(201).json({ added: added.length });
});

shoppingRouter.put('/items/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(req.params.id) as ShoppingItemRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  const b = req.body ?? {};
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : existing.name;
  const checked = b.checked !== undefined ? (b.checked ? 1 : 0) : existing.checked;
  const quantity = b.quantity !== undefined ? (b.quantity === null || b.quantity === '' ? null : Number(b.quantity)) : existing.quantity;
  const next = {
    name,
    name_key: nameKey(name),
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit: b.unit !== undefined ? b.unit?.trim() || null : existing.unit,
    note: b.note !== undefined ? b.note?.trim() || null : existing.note,
    category_id: b.category_id !== undefined ? b.category_id || null : existing.category_id,
    checked,
    checked_at: checked && !existing.checked ? new Date().toISOString() : checked ? existing.checked_at : null,
  };
  db.prepare(
    `UPDATE shopping_items SET name=@name, name_key=@name_key, quantity=@quantity, unit=@unit, note=@note,
     category_id=@category_id, checked=@checked, checked_at=@checked_at, updated_at=@now WHERE id=@id`
  ).run({ ...next, now: new Date().toISOString(), id: req.params.id });
  // Moving something to another aisle is remembered for next time.
  if (b.category_id !== undefined || b.name !== undefined) {
    const item = rememberItem(next.name, next.category_id, false);
    db.prepare('UPDATE shopping_items SET item_id = ? WHERE id = ?').run(item.id, req.params.id);
  }
  res.json(itemOut(db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(req.params.id) as ShoppingItemRow));
});

shoppingRouter.delete('/items/:id', (req, res) => {
  const r = db.prepare('DELETE FROM shopping_items WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Item not found' });
  res.status(204).end();
});

// Ticked items are bought, so they move to the pantry on the way out
// (unless { toPantry: false }).
shoppingRouter.post('/lists/:id/clear-checked', (req, res) => {
  const ticked = db.prepare('SELECT * FROM shopping_items WHERE list_id = ? AND checked = 1').all(req.params.id) as ShoppingItemRow[];
  const toPantry = req.body?.toPantry !== false;
  db.transaction(() => {
    if (toPantry) for (const i of ticked) addToPantry({ itemId: i.item_id ?? undefined, name: i.name, quantity: i.quantity, unit: i.unit, source: 'shopping' });
    db.prepare('DELETE FROM shopping_items WHERE list_id = ? AND checked = 1').run(req.params.id);
  })();
  res.json({ removed: ticked.length, toPantry: toPantry ? ticked.length : 0 });
});

// GET /api/shopping/suggest?q=pot — things bought before, most used first
shoppingRouter.get('/suggest', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  if (!q) return res.json([]);
  res.json(
    db
      .prepare(
        `SELECT name, category_id FROM items
         WHERE name_key LIKE ? OR name LIKE ? OR id IN (SELECT item_id FROM item_aliases WHERE kind = 'name' AND value LIKE ?)
         ORDER BY (name_key LIKE ?) DESC, use_count DESC, name LIMIT 8`
      )
      .all(`%${q}%`, `%${q}%`, `%${q}%`, `${q}%`)
  );
});
