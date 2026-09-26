import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { db, UPLOADS_DIR } from '../db';
import { getTags, loadRecipe, RecipeRow, saveRecipe } from '../recipes';
import { deleteUpload, downloadImage } from '../import/fetch';
import { previewIngredients } from '../shopping';
import { nameKey } from '../ingredients';
import { pantryCovers, pantryKeys } from '../items';
import { recipeCost } from '../costing';

export const recipesRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

/** Cards for the recipe grid (also used by the MCP search_recipes tool). */
export function listRecipes(filter: { q?: string; tag?: string; favorite?: boolean }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = filter.q?.trim() ?? '';
  if (q) {
    // Matches the name, or any ingredient: "what can I make with chicken?"
    where.push(`(r.name LIKE ? OR r.id IN (SELECT recipe_id FROM recipe_ingredients WHERE name LIKE ?))`);
    params.push(`%${q}%`, `%${q}%`);
  }
  if (filter.tag) {
    where.push('r.id IN (SELECT rt.recipe_id FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE t.name = ?)');
    params.push(filter.tag);
  }
  if (filter.favorite) where.push('r.favorite = 1');
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.image_path, r.total_minutes, r.servings, r.favorite, r.source_name, r.updated_at
       FROM recipes r ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.favorite DESC, r.name COLLATE NOCASE`
    )
    .all(...params) as Pick<RecipeRow, 'id' | 'name' | 'image_path' | 'total_minutes' | 'servings' | 'favorite'>[];
  // How much of each recipe is already in the cupboard (pantry or staples),
  // for "what can I make tonight?".
  const have = [...pantryKeys(), ...(db.prepare('SELECT name_key FROM staples').all() as { name_key: string }[]).map((s) => s.name_key)];
  const ingredientsOf = db.prepare('SELECT name FROM recipe_ingredients WHERE recipe_id = ?');
  return rows.map((r) => {
      const keys = (ingredientsOf.all(r.id) as { name: string }[]).map((i) => nameKey(i.name));
      return {
        ...r,
        favorite: Boolean(r.favorite),
        tags: getTags(r.id),
        ingredient_count: keys.length,
        have_count: keys.filter((k) => pantryCovers(k, have)).length,
      };
    });
}

// GET /api/recipes?q=&tag=&favorite=1
recipesRouter.get('/', (req, res) => {
  res.json(
    listRecipes({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
      favorite: req.query.favorite === '1',
    })
  );
});

recipesRouter.get('/:id', (req, res) => {
  const recipe = loadRecipe(req.params.id);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
  res.json(recipe);
});

// POST /api/recipes — body may carry image_url (from an import) to download
recipesRouter.post('/', async (req, res) => {
  if (!req.body?.name?.trim()) return res.status(400).json({ error: 'name is required' });
  const image = typeof req.body.image_url === 'string' && req.body.image_url ? await downloadImage(req.body.image_url) : null;
  const id = saveRecipe(req.body, null, image);
  res.status(201).json(loadRecipe(id));
});

recipesRouter.put('/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id) as RecipeRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Recipe not found' });
  if (!req.body?.name?.trim()) return res.status(400).json({ error: 'name is required' });
  saveRecipe(req.body, req.params.id);
  if (typeof req.body.image_url === 'string' && req.body.image_url) {
    const image = await downloadImage(req.body.image_url);
    if (image) {
      db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(image, req.params.id);
      deleteUpload(existing.image_path);
    }
  }
  res.json(loadRecipe(req.params.id));
});

recipesRouter.put('/:id/favorite', (req, res) => {
  const r = db.prepare('UPDATE recipes SET favorite = ? WHERE id = ?').run(req.body?.favorite ? 1 : 0, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Recipe not found' });
  res.json(loadRecipe(req.params.id));
});

recipesRouter.post('/:id/photo', upload.single('photo'), (req, res) => {
  const existing = db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(req.params.id) as
    | { image_path: string | null }
    | undefined;
  if (!req.file) return res.status(400).json({ error: 'Choose an image file' });
  if (!existing) {
    deleteUpload(req.file.filename);
    return res.status(404).json({ error: 'Recipe not found' });
  }
  db.prepare('UPDATE recipes SET image_path = ?, updated_at = ? WHERE id = ?').run(req.file.filename, new Date().toISOString(), req.params.id);
  deleteUpload(existing.image_path);
  res.json(loadRecipe(req.params.id));
});

recipesRouter.delete('/:id/photo', (req, res) => {
  const existing = db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(req.params.id) as
    | { image_path: string | null }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Recipe not found' });
  db.prepare('UPDATE recipes SET image_path = NULL WHERE id = ?').run(req.params.id);
  deleteUpload(existing.image_path);
  res.json(loadRecipe(req.params.id));
});

// GET /api/recipes/:id/cost?servings=6&store=1 — from prices paid; store=1 fills gaps from cached shop prices
recipesRouter.get('/:id/cost', async (req, res) => {
  try {
    res.json(await recipeCost(req.params.id, Number(req.query.servings) || null, { storeFallback: req.query.store === '1' }));
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/recipes/:id/shopping-preview { servings } — lines to review before adding
recipesRouter.post('/:id/shopping-preview', (req, res) => {
  const exists = db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Recipe not found' });
  res.json(previewIngredients([{ recipe_id: req.params.id, servings: Number(req.body?.servings) || null }]));
});

recipesRouter.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT image_path FROM recipes WHERE id = ?').get(req.params.id) as
    | { image_path: string | null }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Recipe not found' });
  db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM recipe_tags)').run();
  db.prepare('DELETE FROM imported WHERE local_id = ?').run(req.params.id);
  deleteUpload(existing.image_path);
  res.status(204).end();
});

export const tagsRouter = Router();

tagsRouter.get('/', (_req, res) => {
  res.json(
    db
      .prepare(
        'SELECT t.name, COUNT(rt.recipe_id) AS count FROM tags t JOIN recipe_tags rt ON rt.tag_id = t.id GROUP BY t.id ORDER BY count DESC, t.name'
      )
      .all()
  );
});
