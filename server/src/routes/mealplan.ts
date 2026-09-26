import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../db';
import { previewIngredients } from '../shopping';

export const mealPlanRouter = Router();

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ENTRY_SELECT = `
  SELECT m.*, r.image_path, r.total_minutes, r.servings AS recipe_servings
  FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id`;

function loadEntry(id: string) {
  return db.prepare(`${ENTRY_SELECT} WHERE m.id = ?`).get(id);
}

// GET /api/mealplan?start=2026-09-21&end=2026-09-27
mealPlanRouter.get('/', (req, res) => {
  const { start, end } = req.query;
  if (typeof start !== 'string' || typeof end !== 'string' || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    return res.status(400).json({ error: 'start and end (YYYY-MM-DD) are required' });
  }
  res.json(db.prepare(`${ENTRY_SELECT} WHERE m.date BETWEEN ? AND ? ORDER BY m.date, m.position, m.created_at`).all(start, end));
});

function validate(body: any, partial = false): string | null {
  if ((!partial || body.date !== undefined) && !DATE_RE.test(body.date ?? '')) return 'date (YYYY-MM-DD) is required';
  if ((!partial || body.slot !== undefined) && !SLOTS.includes(body.slot)) return `slot must be one of ${SLOTS.join(', ')}`;
  return null;
}

mealPlanRouter.post('/', (req, res) => {
  const body = req.body ?? {};
  const error = validate(body);
  if (error) return res.status(400).json({ error });
  let title = typeof body.title === 'string' ? body.title.trim() : '';
  let recipeId: string | null = body.recipe_id || null;
  if (recipeId) {
    const recipe = db.prepare('SELECT name, servings FROM recipes WHERE id = ?').get(recipeId) as { name: string } | undefined;
    if (!recipe) return res.status(400).json({ error: 'Recipe not found' });
    title = recipe.name;
  }
  if (!title) return res.status(400).json({ error: 'Pick a recipe or type a note' });
  const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM meal_plan WHERE date = ? AND slot = ?').get(body.date, body.slot) as { p: number }).p;
  const id = uuid();
  db.prepare(
    'INSERT INTO meal_plan (id, date, slot, position, recipe_id, title, servings, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, body.date, body.slot, position, recipeId, title, Number(body.servings) || null, body.note?.trim() || null, new Date().toISOString());
  res.status(201).json(loadEntry(id));
});

// PUT /api/mealplan/:id — move (date/slot), or change servings/title/note
mealPlanRouter.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM meal_plan WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  const body = req.body ?? {};
  const error = validate(body, true);
  if (error) return res.status(400).json({ error });
  const next = {
    date: body.date ?? existing.date,
    slot: body.slot ?? existing.slot,
    servings: body.servings !== undefined ? Number(body.servings) || null : existing.servings,
    note: body.note !== undefined ? body.note?.trim() || null : existing.note,
    title: !existing.recipe_id && typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing.title,
  };
  db.prepare('UPDATE meal_plan SET date = ?, slot = ?, servings = ?, note = ?, title = ? WHERE id = ?').run(
    next.date,
    next.slot,
    next.servings,
    next.note,
    next.title,
    req.params.id
  );
  res.json(loadEntry(req.params.id));
});

mealPlanRouter.delete('/:id', (req, res) => {
  const r = db.prepare('DELETE FROM meal_plan WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Entry not found' });
  res.status(204).end();
});

// POST /api/mealplan/shopping-preview { start, end } — every planned recipe's ingredients, merged
mealPlanRouter.post('/shopping-preview', (req, res) => {
  const { start, end } = req.body ?? {};
  if (!DATE_RE.test(start ?? '') || !DATE_RE.test(end ?? '')) return res.status(400).json({ error: 'start and end are required' });
  const entries = db
    .prepare('SELECT recipe_id, servings FROM meal_plan WHERE date BETWEEN ? AND ? AND recipe_id IS NOT NULL')
    .all(start, end) as { recipe_id: string; servings: number | null }[];
  res.json(previewIngredients(entries));
});
