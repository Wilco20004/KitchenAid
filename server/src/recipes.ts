import { v4 as uuid } from 'uuid';
import { db } from './db';
import { parseIngredient } from './ingredients';

export interface RecipeRow {
  id: string;
  name: string;
  description: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  source_url: string | null;
  source_name: string | null;
  image_path: string | null;
  notes: string | null;
  favorite: number;
  created_at: string;
  updated_at: string;
}

export interface RecipeInput {
  name: string;
  description?: string | null;
  servings?: number | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  total_minutes?: number | null;
  source_url?: string | null;
  source_name?: string | null;
  notes?: string | null;
  tags?: string[];
  ingredients?: { section: string | null; raw: string }[];
  steps?: { section: string | null; text: string }[];
}

const intOrNull = (v: unknown) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0 ? null : Math.round(n);
};
const strOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function getTags(recipeId: string): string[] {
  return (
    db
      .prepare('SELECT t.name FROM tags t JOIN recipe_tags rt ON rt.tag_id = t.id WHERE rt.recipe_id = ? ORDER BY t.name')
      .all(recipeId) as { name: string }[]
  ).map((t) => t.name);
}

function setTags(recipeId: string, tags: string[]) {
  db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?').run(recipeId);
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  for (const name of clean) {
    db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)').run(uuid(), name);
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: string };
    db.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)').run(recipeId, tag.id);
  }
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM recipe_tags)').run();
}

function setIngredients(recipeId: string, lines: { section: string | null; raw: string }[]) {
  db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(recipeId);
  const insert = db.prepare(
    `INSERT INTO recipe_ingredients (id, recipe_id, position, section, raw, quantity, quantity_max, unit, name, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  lines
    .filter((l) => l.raw?.trim())
    .forEach((l, i) => {
      const p = parseIngredient(l.raw);
      insert.run(uuid(), recipeId, i, strOrNull(l.section), l.raw.trim(), p.quantity, p.quantity_max, p.unit, p.name, p.note);
    });
}

function setSteps(recipeId: string, steps: { section: string | null; text: string }[]) {
  db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').run(recipeId);
  const insert = db.prepare('INSERT INTO recipe_steps (id, recipe_id, position, section, text) VALUES (?, ?, ?, ?, ?)');
  steps
    .filter((s) => s.text?.trim())
    .forEach((s, i) => insert.run(uuid(), recipeId, i, strOrNull(s.section), s.text.trim()));
}

export const saveRecipe = db.transaction((input: RecipeInput, id: string | null, imagePath?: string | null): string => {
  const now = new Date().toISOString();
  const fields = {
    name: input.name.trim(),
    description: strOrNull(input.description),
    servings: intOrNull(input.servings),
    prep_minutes: intOrNull(input.prep_minutes),
    cook_minutes: intOrNull(input.cook_minutes),
    total_minutes: intOrNull(input.total_minutes),
    source_url: strOrNull(input.source_url),
    source_name: strOrNull(input.source_name),
    notes: strOrNull(input.notes),
  };
  if (!fields.total_minutes && (fields.prep_minutes || fields.cook_minutes)) {
    fields.total_minutes = (fields.prep_minutes ?? 0) + (fields.cook_minutes ?? 0);
  }
  if (id) {
    db.prepare(
      `UPDATE recipes SET name=@name, description=@description, servings=@servings, prep_minutes=@prep_minutes,
       cook_minutes=@cook_minutes, total_minutes=@total_minutes, source_url=@source_url, source_name=@source_name,
       notes=@notes, updated_at=@now WHERE id=@id`
    ).run({ ...fields, now, id });
  } else {
    id = uuid();
    db.prepare(
      `INSERT INTO recipes (id, name, description, servings, prep_minutes, cook_minutes, total_minutes, source_url,
       source_name, image_path, notes, favorite, created_at, updated_at)
       VALUES (@id, @name, @description, @servings, @prep_minutes, @cook_minutes, @total_minutes, @source_url,
       @source_name, @image_path, @notes, 0, @now, @now)`
    ).run({ ...fields, id, image_path: imagePath ?? null, now });
  }
  if (input.tags) setTags(id, input.tags);
  if (input.ingredients) setIngredients(id, input.ingredients);
  if (input.steps) setSteps(id, input.steps);
  return id;
});

export function loadRecipe(id: string) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as RecipeRow | undefined;
  if (!recipe) return null;
  return {
    ...recipe,
    favorite: Boolean(recipe.favorite),
    tags: getTags(id),
    ingredients: db.prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position').all(id),
    steps: db.prepare('SELECT * FROM recipe_steps WHERE recipe_id = ? ORDER BY position').all(id),
  };
}
