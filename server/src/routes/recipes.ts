import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { db, UPLOADS_DIR } from '../db';
import { getTags, ingredientFields, itemCatalogue, loadRecipe, RecipeRow, saveRecipe, setIngredientLinks, suggestItemFor } from '../recipes';
import { deleteUpload, downloadImage } from '../import/fetch';
import { previewIngredients } from '../shopping';
import { nameKey } from '../ingredients';
import { pantryCovers, pantryKeys } from '../items';
import { recipeCost } from '../costing';
import { applyUse, cookPlan } from '../cooking';

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
  const ingredientsOf = db.prepare(
    'SELECT ri.name, i.name_key AS item_key, i.in_pantry AS item_in_pantry FROM recipe_ingredients ri LEFT JOIN items i ON i.id = ri.item_id WHERE ri.recipe_id = ?'
  );
  const staples = new Set((db.prepare('SELECT name_key FROM staples').all() as { name_key: string }[]).map((s) => s.name_key));
  return rows.map((r) => {
      const ings = ingredientsOf.all(r.id) as { name: string; item_key: string | null; item_in_pantry: number | null }[];
      return {
        ...r,
        favorite: Boolean(r.favorite),
        tags: getTags(r.id),
        ingredient_count: ings.length,
        have_count: ings.filter((i) =>
          i.item_key ? Boolean(i.item_in_pantry) || staples.has(i.item_key) : pantryCovers(nameKey(i.name), have)
        ).length,
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

// POST /api/recipes/parse-ingredients { lines: [{ section, raw }] } — pasted lines as editor rows,
// each with a suggested item to link (nothing is saved).
recipesRouter.post('/parse-ingredients', (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!lines) return res.status(400).json({ error: 'lines are required' });
  const catalogue = itemCatalogue();
  res.json(
    lines
      .filter((l: any) => typeof l?.raw === 'string' && l.raw.trim())
      .map((l: any) => {
        const f = ingredientFields({ section: null, raw: l.raw });
        return { section: typeof l.section === 'string' && l.section.trim() ? l.section.trim() : null, ...f, suggested: suggestItemFor(f.name, catalogue) };
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

// PUT /api/recipes/:id/links { links: [{ id, item_id | item_name | no_link }] } — confirm suggested links
recipesRouter.put('/:id/links', (req, res) => {
  const links = Array.isArray(req.body?.links) ? req.body.links.filter((l: any) => typeof l?.id === 'string') : null;
  if (!links) return res.status(400).json({ error: 'links are required' });
  if (!loadRecipe(req.params.id)) return res.status(404).json({ error: 'Recipe not found' });
  try {
    setIngredientLinks(req.params.id, links);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
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

// GET /api/recipes/:id/cook?servings=4 — what cooking it would take from the pantry
recipesRouter.get('/:id/cook', (req, res) => {
  try {
    res.json(cookPlan(req.params.id, Number(req.query.servings) || null));
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/recipes/:id/cook { lines: [{ item_id, amount: "500 g" | null, used_up }] } — the reviewed plan
recipesRouter.post('/:id/cook', (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!lines) return res.status(400).json({ error: 'lines are required' });
  try {
    res.json({ results: applyUse(lines.filter((l: any) => typeof l?.item_id === 'string')) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
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
