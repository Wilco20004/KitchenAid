import { v4 as uuid } from 'uuid';
import { db } from './db';
import { formatQuantity, nameKey, normalizeUnit, parseIngredient, parseQuantity } from './ingredients';
import { ensureItem, ensureItemRef, findItem, getItem, ItemRow, wordsWithin } from './items';
import { sameProductForm } from './productForms';

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
  ingredients?: IngredientInput[];
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

/** An ingredient as the editor (or an AI assistant) sends it: either a raw line to parse, or the fields themselves. */
export interface IngredientInput {
  section: string | null;
  raw?: string;
  amount?: string | null;
  quantity?: number | null;
  quantity_max?: number | null;
  unit?: string | null;
  name?: string;
  note?: string | null;
  item_id?: string | null;
  /** Link to the item of this name, made if it doesn't exist yet. */
  item_name?: string | null;
  no_link?: boolean;
}

interface IngredientRow {
  id: string;
  section: string | null;
  raw: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
  name: string;
  note: string | null;
  item_id: string | null;
  no_link: number;
}

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** The line as it reads: "1¾ cup plain flour, sifted". */
export function composeLine(i: { quantity: number | null; quantity_max: number | null; unit: string | null; name: string; note: string | null }): string {
  const amount =
    i.quantity !== null
      ? `${formatQuantity(i.quantity, i.unit)}${i.quantity_max !== null ? `–${formatQuantity(i.quantity_max, i.unit)}` : ''}`
      : '';
  return [amount, i.unit ?? '', i.name].filter(Boolean).join(' ') + (i.note ? `, ${i.note}` : '');
}

/** One ingredient's fields from whatever was sent. */
export function ingredientFields(l: IngredientInput) {
  if (typeof l.name === 'string' && l.name.trim()) {
    let quantity = numOrNull(l.quantity);
    let quantity_max = numOrNull(l.quantity_max);
    if (typeof l.amount === 'string') ({ quantity, quantity_max } = parseQuantity(l.amount));
    if (quantity === null) quantity_max = null;
    const fields = {
      quantity,
      quantity_max,
      unit: normalizeUnit(l.unit),
      name: l.name.trim(),
      note: strOrNull(l.note),
    };
    return { ...fields, raw: composeLine(fields) };
  }
  const raw = (l.raw ?? '').trim();
  return { ...parseIngredient(raw), raw };
}

function setIngredients(recipeId: string, lines: IngredientInput[]) {
  // Lines sent as plain text (an import, an older client) keep the link the
  // same line had before.
  const before = db.prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ?').all(recipeId) as IngredientRow[];
  const byRaw = new Map(before.map((r) => [r.raw, r]));
  const byKey = new Map(before.map((r) => [nameKey(r.name), r]));
  db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(recipeId);
  const insert = db.prepare(
    `INSERT INTO recipe_ingredients (id, recipe_id, position, section, raw, quantity, quantity_max, unit, name, note, item_id, no_link)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const rows = lines
    .filter((l) => (typeof l.name === 'string' && l.name.trim()) || l.raw?.trim())
    .map((l) => {
      const f = ingredientFields(l);
      const structured = typeof l.name === 'string' && l.name.trim() !== '';
      const prev = structured ? undefined : byRaw.get(f.raw) ?? byKey.get(nameKey(f.name));
      let itemId: string | null = prev?.item_id ?? null;
      let noLink = Boolean(prev?.no_link);
      if (structured || l.item_id !== undefined || l.item_name !== undefined || l.no_link !== undefined) {
        itemId = null;
        if (l.item_id && getItem(l.item_id)) itemId = l.item_id;
        else if (l.item_name?.trim()) itemId = ensureItem(l.item_name.trim()).id;
        noLink = !itemId && Boolean(l.no_link);
      }
      return { l, f, itemId, noLink };
    });
  rows.forEach((r, i) => {
    insert.run(uuid(), recipeId, i, strOrNull(r.l.section), r.f.raw, r.f.quantity, r.f.quantity_max, r.f.unit, r.f.name, r.f.note, r.itemId, r.noLink ? 1 : 0);
    // A linked item always has a short name, so steps can use it.
    if (r.itemId) ensureItemRef(r.itemId);
  });
}

export function itemCatalogue() {
  return (
    db
      .prepare(
        `SELECT i.id, i.name, i.name_key, i.in_pantry, i.unit_price, i.use_count,
           (SELECT group_concat(a.value, '|') FROM item_aliases a WHERE a.item_id = i.id AND a.kind = 'name') AS names
         FROM items i`
      )
      .all() as { id: string; name: string; name_key: string; in_pantry: number; unit_price: number | null; use_count: number; names: string | null }[]
  ).map((i) => ({ ...i, keys: [i.name_key, ...(i.names?.split('|') ?? [])] }));
}

// Words that only describe an ingredient, so "2 large eggs, beaten" may be
// offered Eggs — unlike "sour" (sour cream is not Cream) or "canola".
const DESCRIPTIVE = new Set(
  ('large medium small big fresh extra whole ripe free-range free range organic chopped diced sliced minced grated crushed ' +
    'shredded boneless skinless lean plain white full fat unsalted salted raw cooked frozen dried dry finely roughly ' +
    'fine coarse granulated all purpose all-purpose regular good quality of a the cold warm hot room temperature soft ' +
    'softened melted beaten peeled ground juiced zested halved quartered thinly thickly washed rinsed drained').split(' ')
);

// Other names for the same thing, as South African shops sell it.
const SYNONYMS: [RegExp, string][] = [
  [/\b(?:plain|all purpose|all-purpose)\s+flour\b/, 'cake flour'],
  [/\b(?:bi-?carb(?:onate)?(?:\s+of)?(?:\s+soda)?|bicarbonate)\b/, 'baking soda'],
  [/\bcorn\s*starch\b/, 'cornflour'],
  [/\bcilantro\b/, 'coriander'],
  [/\bscallions?\b/, 'spring onion'],
  [/\b(?:zucchini|courgettes?)\b/, 'baby marrow'],
  [/\b(?:eggplant|aubergine)s?\b/, 'brinjal'],
  [/\b(?:powdered|confectioners?)\s+sugar\b/, 'icing sugar'],
  [/\bcaster\s+sugar\b/, 'castor sugar'],
];

/**
 * The catalogue item an ingredient most likely is, to offer as a link: the
 * item of that name (or one of its other names, or a synonym — plain flour
 * is Cake flour), else one whose name is the ingredient's less only
 * describing words ("large eggs" → Eggs), or that names it more exactly
 * ("milk" → Full cream milk) — never one that turns it into another product.
 * Closest word count wins, then ones at home, priced, or often used.
 */
export function suggestItemFor(name: string, catalogue = itemCatalogue()): { id: string; name: string } | null {
  // "baking soda / bi-carb": the first way of saying it.
  const first = name.split('/')[0].trim() || name;
  let key = nameKey(first);
  for (const [re, to] of SYNONYMS) key = key.replace(re, to);
  if (!key) return null;
  const exact = findItem({ name: first }) ?? findItem({ name: key });
  if (exact) return { id: exact.id, name: exact.name };
  const mine = key.split(' ');
  const fits = (k: string) => {
    if (wordsWithin(key, k)) return true;
    if (!wordsWithin(k, key)) return false;
    const theirs = new Set(k.split(' '));
    return mine.every((w) => theirs.has(w) || DESCRIPTIVE.has(w));
  };
  const best = catalogue
    .filter((i) => i.keys.some(fits) && sameProductForm(key, i.name))
    .sort(
      (a, b) =>
        Math.abs(a.name_key.split(' ').length - mine.length) - Math.abs(b.name_key.split(' ').length - mine.length) ||
        b.in_pantry - a.in_pantry ||
        Number(b.unit_price !== null) - Number(a.unit_price !== null) ||
        b.use_count - a.use_count
    )[0];
  return best ? { id: best.id, name: best.name } : null;
}

/** The item an ingredient stands for: its link, else (unless told not to link it) the best guess by name. */
export function itemOfIngredient(
  ing: { item_id?: string | null; no_link?: number | boolean; name: string },
  byName: (name: string) => ItemRow | undefined
): ItemRow | undefined {
  if (ing.item_id) return getItem(ing.item_id);
  if (ing.no_link) return undefined;
  return byName(ing.name);
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
  const rows = db
    .prepare(
      `SELECT ri.*, i.name AS item_name, i.in_pantry AS item_in_pantry, i.ref AS item_ref FROM recipe_ingredients ri
       LEFT JOIN items i ON i.id = ri.item_id WHERE ri.recipe_id = ? ORDER BY ri.position`
    )
    .all(id) as (IngredientRow & { item_name: string | null; item_in_pantry: number | null; item_ref: string | null })[];
  const catalogue = rows.some((r) => !r.item_id && !r.no_link) ? itemCatalogue() : [];
  const ingredients = rows.map(({ item_name, item_in_pantry, item_ref, ...r }) => ({
    ...r,
    // Steps use the linked item's short name ({{flour}}); unlinked ingredients have none.
    ref: r.item_id ? item_ref : null,
    no_link: Boolean(r.no_link),
    item: r.item_id ? { id: r.item_id, name: item_name!, in_pantry: Boolean(item_in_pantry) } : null,
    suggested: !r.item_id && !r.no_link ? suggestItemFor(r.name, catalogue) : null,
  }));
  return {
    ...recipe,
    favorite: Boolean(recipe.favorite),
    tags: getTags(id),
    ingredients,
    steps: db.prepare('SELECT * FROM recipe_steps WHERE recipe_id = ? ORDER BY position').all(id),
  };
}

/** Link (or unlink) ingredients without touching anything else: { id, item_id | item_name | no_link }. */
export const setIngredientLinks = db.transaction(
  (recipeId: string, links: { id: string; item_id?: string | null; item_name?: string | null; no_link?: boolean }[]): number => {
    const update = db.prepare('UPDATE recipe_ingredients SET item_id = ?, no_link = ? WHERE id = ? AND recipe_id = ?');
    let changed = 0;
    for (const l of links) {
      let itemId: string | null = null;
      if (l.item_id) {
        if (!getItem(l.item_id)) throw new Error('Item not found');
        itemId = l.item_id;
      } else if (l.item_name?.trim()) itemId = ensureItem(l.item_name.trim()).id;
      if (itemId) ensureItemRef(itemId);
      changed += update.run(itemId, !itemId && l.no_link ? 1 : 0, l.id, recipeId).changes;
    }
    if (changed) db.prepare('UPDATE recipes SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), recipeId);
    return changed;
  }
);
