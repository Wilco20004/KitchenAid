import { v4 as uuid } from 'uuid';
import { db } from './db';
import { addAmounts, Amount, formatAmount, nameKey, unitFamily } from './ingredients';
import { categoryFor, pantryCovers, pantryKeys, rememberItem } from './items';

export interface ShoppingItemRow {
  id: string;
  list_id: string;
  name: string;
  name_key: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  category_id: string | null;
  item_id: string | null;
  sources: string | null;
  checked: number;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewItem {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
  source?: string | null;
  category_id?: string | null;
}

function joinSources(a: string | null, b: string | null | undefined): string | null {
  const parts = new Set([...(a ? a.split(' · ') : []), ...(b ? b.split(' · ') : [])]);
  return parts.size ? [...parts].join(' · ') : null;
}

/**
 * Put something on a list. If the same thing is already there and not yet
 * ticked off, amounts are added up instead ("2 onions" + "1 onion" = 3),
 * as long as the units can be combined; otherwise it gets its own line.
 */
export function addItem(listId: string, item: NewItem): ShoppingItemRow {
  const name = item.name.trim();
  // Lines are matched through the item catalogue, so "Royco brown onion
  // soup" tops up an existing "Brown onion soup" line once they're linked.
  const known = rememberItem(name, item.category_id ?? null);
  const key = known.name_key;
  const now = new Date().toISOString();
  const incoming: Amount = { quantity: item.quantity ?? null, unit: item.unit ?? null };

  const open = db
    .prepare('SELECT * FROM shopping_items WHERE list_id = ? AND (item_id = ? OR name_key = ?) AND checked = 0')
    .all(listId, known.id, key) as ShoppingItemRow[];
  for (const existing of open) {
    const sum = addAmounts({ quantity: existing.quantity, unit: existing.unit }, incoming);
    if (!sum) continue;
    db.prepare('UPDATE shopping_items SET quantity = ?, unit = ?, sources = ?, note = COALESCE(note, ?), updated_at = ? WHERE id = ?').run(
      sum.quantity,
      sum.unit,
      joinSources(existing.sources, item.source),
      item.note ?? null,
      now,
      existing.id
    );
    return db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(existing.id) as ShoppingItemRow;
  }

  const categoryId = item.category_id ?? known.category_id ?? categoryFor(key);
  const id = uuid();
  db.prepare(
    `INSERT INTO shopping_items (id, list_id, name, name_key, quantity, unit, note, category_id, item_id, sources, checked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, listId, name, key, incoming.quantity, incoming.unit, item.note ?? null, categoryId, known.id, item.source ?? null, now, now);
  return db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id) as ShoppingItemRow;
}

export interface PreviewLine {
  key: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  amount: string;
  sources: string[];
  staple: boolean;
  in_pantry: boolean;
}

/**
 * Everything a set of recipes needs, each scaled to the servings asked for,
 * with the same ingredient across recipes merged. Nothing is added yet — the
 * UI shows this so you can untick what's already in the cupboard.
 */
export function previewIngredients(entries: { recipe_id: string; servings: number | null }[]): PreviewLine[] {
  const staples = new Set((db.prepare('SELECT name_key FROM staples').all() as { name_key: string }[]).map((s) => s.name_key));
  const inPantry = pantryKeys();
  const lines = new Map<string, PreviewLine>();

  for (const entry of entries) {
    const recipe = db.prepare('SELECT name, servings FROM recipes WHERE id = ?').get(entry.recipe_id) as
      | { name: string; servings: number | null }
      | undefined;
    if (!recipe) continue;
    const factor = recipe.servings && entry.servings ? entry.servings / recipe.servings : 1;
    const ingredients = db
      .prepare('SELECT name, quantity, unit FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position')
      .all(entry.recipe_id) as { name: string; quantity: number | null; unit: string | null }[];

    for (const ing of ingredients) {
      const key = nameKey(ing.name);
      const amount: Amount = { quantity: ing.quantity === null ? null : ing.quantity * factor, unit: ing.unit };
      // Separate buckets per unit family so "2 cups flour" and "100 g flour" don't fight.
      let bucket = `${key}|${unitFamily(amount.unit)}`;
      const existing = lines.get(bucket);
      if (existing) {
        const sum = addAmounts(existing, amount);
        if (sum) {
          Object.assign(existing, sum, { amount: formatAmount(sum) });
          if (!existing.sources.includes(recipe.name)) existing.sources.push(recipe.name);
          continue;
        }
        bucket += `|${lines.size}`;
      }
      lines.set(bucket, {
        key,
        name: ing.name,
        quantity: amount.quantity,
        unit: amount.unit,
        amount: formatAmount(amount),
        sources: [recipe.name],
        staple: staples.has(key),
        in_pantry: pantryCovers(key, inPantry),
      });
    }
  }
  return [...lines.values()];
}
