import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db';
import { nameKey } from '../ingredients';

// Aisles (shopping list categories) and pantry staples.

export const categoriesRouter = Router();

categoriesRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY position, name').all());
});

categoriesRouter.post('/', (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM categories').get() as { p: number }).p;
  const id = uuid();
  db.prepare('INSERT INTO categories (id, name, position) VALUES (?, ?, ?)').run(id, name, position);
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
});

// PUT /api/categories/order { ids: [...] } — the order you walk the shop
categoriesRouter.put('/order', (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  db.transaction(() => ids.forEach((id, i) => db.prepare('UPDATE categories SET position = ? WHERE id = ?').run(i, id)))();
  res.json(db.prepare('SELECT * FROM categories ORDER BY position, name').all());
});

categoriesRouter.put('/:id', (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const r = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Aisle not found' });
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

categoriesRouter.delete('/:id', (req, res) => {
  const r = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Aisle not found' });
  res.status(204).end();
});

export const staplesRouter = Router();

staplesRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM staples ORDER BY name COLLATE NOCASE').all());
});

staplesRouter.post('/', (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const key = nameKey(name);
  db.prepare('INSERT OR REPLACE INTO staples (name_key, name) VALUES (?, ?)').run(key, name);
  res.status(201).json({ name_key: key, name });
});

staplesRouter.delete('/:key', (req, res) => {
  db.prepare('DELETE FROM staples WHERE name_key = ?').run(req.params.key);
  res.status(204).end();
});
