import { db } from './db';
import { Amount, formatAmount as formatSingular, nameKey, parseIngredient } from './ingredients';
import { findItem, getItem, ItemRow, packOf, removeFromPantry, wordsWithin } from './items';
import { sameProductForm } from './productForms';
import { PackContents, subtractAmounts } from './amounts';

// Taking what was used out of the pantry: after cooking a recipe ("I cooked
// this") or by hand ("Use some" — 2 hake medallions for lunch). Amounts come
// off where the units allow (1 kg mince − 500 g = 500 g left); what reaches
// nothing leaves the pantry. Something at home without an amount can only be
// marked used up.

export interface UsePlanLine {
  ingredient: string;
  item_id: string;
  item: string;
  have: string | null;
  use: Amount;
  use_text: string;
  /** What's left afterwards; null when it can't be worked out (units don't mix, or no amount at home). */
  left: Amount | null;
  left_text: string | null;
  /** subtract: some stays; use_up: this finishes it; unknown: can only be ticked as used up. */
  action: 'subtract' | 'use_up' | 'unknown';
  approx: boolean;
}

export interface UseResult {
  item: string;
  left: string | null;
  removed: boolean;
  skipped?: string;
}

const NO_PLURAL = new Set(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'oz', 'lb', 'fl oz']);

/** "3 packets", "1 sachet", "500 g" — as the pantry page writes them. */
function formatAmount(a: Amount): string {
  const text = formatSingular(a);
  if (!a.unit || a.quantity === null || a.quantity <= 1 || NO_PLURAL.has(a.unit)) return text;
  return `${text}${/(ch|sh|s|x)$/.test(a.unit) ? 'es' : 's'}`;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The pantry item a recipe ingredient takes from, if any: "beef mince" → Beef Mince, never "coconut milk" → Milk. */
export function pantryItemFor(name: string): ItemRow | undefined {
  const exact = findItem({ name });
  if (exact?.in_pantry) return exact;
  const key = nameKey(name);
  if (!key) return undefined;
  const rows = db
    .prepare(
      `SELECT i.*, (SELECT group_concat(a.value, '|') FROM item_aliases a WHERE a.item_id = i.id AND a.kind = 'name') AS names
       FROM items i WHERE i.in_pantry = 1`
    )
    .all() as (ItemRow & { names: string | null })[];
  return rows
    .filter((i) => [i.name_key, ...(i.names?.split('|') ?? [])].some((k) => k === key || wordsWithin(key, k)))
    .filter((i) => sameProductForm(key, `${i.name} ${i.pack_label ?? ''}`))
    .sort((a, b) => a.name_key.split(' ').length - b.name_key.split(' ').length)[0];
}

/** What's left of `have` after using `use` — see subtractAmounts. */
export function remainingAfter(have: Amount, use: Amount, name: string, pack: PackContents | null = null) {
  return subtractAmounts(have, use, name, pack);
}

function planLine(ingredient: string, item: ItemRow, use: Amount): UsePlanLine {
  const have: Amount = { quantity: item.pantry_quantity, unit: item.pantry_unit };
  const r = remainingAfter(have, use, item.name, packOf(item.pack_label, item.id));
  const finished = r !== null && (r.left.quantity ?? 0) <= 0.0001;
  return {
    ingredient,
    item_id: item.id,
    item: item.name,
    have: have.quantity !== null ? formatAmount(have) : null,
    use,
    use_text: use.quantity !== null ? formatAmount(use) : '',
    left: r && !finished ? r.left : null,
    left_text: r && !finished ? formatAmount(r.left) : null,
    action: r === null ? 'unknown' : finished ? 'use_up' : 'subtract',
    approx: r?.approx ?? false,
  };
}

/**
 * What cooking a recipe would take from the pantry, scaled to the servings
 * cooked. Ingredients not at home, staples and "to taste" lines are left out.
 */
export function cookPlan(recipeId: string, servings?: number | null) {
  const recipe = db.prepare('SELECT name, servings FROM recipes WHERE id = ?').get(recipeId) as { name: string; servings: number | null } | undefined;
  if (!recipe) throw new Error('Recipe not found');
  const factor = recipe.servings && servings ? servings / recipe.servings : 1;
  const ingredients = db
    .prepare('SELECT raw, name, quantity, quantity_max, unit FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position')
    .all(recipeId) as { raw: string; name: string; quantity: number | null; quantity_max: number | null; unit: string | null }[];
  const lines: UsePlanLine[] = [];
  const notAtHome: string[] = [];
  const seen = new Map<string, UsePlanLine>();
  for (const ing of ingredients) {
    const item = pantryItemFor(ing.name);
    if (!item) {
      notAtHome.push(ing.raw);
      continue;
    }
    const qty = ing.quantity === null ? null : r3((ing.quantity_max !== null ? (ing.quantity + ing.quantity_max) / 2 : ing.quantity) * factor);
    let use: Amount = { quantity: qty, unit: ing.unit };
    // The same item twice ("oil" for the mince and for frying): one line.
    const prev = seen.get(item.id);
    if (prev) {
      const sum = prev.use.quantity !== null && use.quantity !== null && prev.use.unit === use.unit ? { quantity: prev.use.quantity + use.quantity, unit: use.unit } : prev.use;
      const merged = planLine(`${prev.ingredient}; ${ing.raw}`, item, sum);
      lines[lines.indexOf(prev)] = merged;
      seen.set(item.id, merged);
      continue;
    }
    const line = planLine(ing.raw, item, use);
    lines.push(line);
    seen.set(item.id, line);
  }
  return { recipe: recipe.name, servings: servings ?? recipe.servings, lines, not_at_home: notAtHome };
}

/** Parse "500 g", "2", "½ cup" into an amount (no item name needed). */
export function parseAmount(text: string): Amount {
  const p = parseIngredient(`${text.trim()} item`);
  return { quantity: p.quantity, unit: p.unit };
}

/**
 * Take an amount of one item out of the pantry, or all of it. When the
 * amount can't come off (no amount recorded, units don't mix) nothing
 * changes unless usedUp is set.
 */
export function useFromPantry(itemId: string, input: { amount?: Amount | null; usedUp?: boolean }): UseResult {
  const item = getItem(itemId);
  if (!item) throw new Error('Item not found');
  if (!item.in_pantry) return { item: item.name, left: null, removed: false, skipped: 'not in the pantry' };
  if (input.usedUp) {
    removeFromPantry(item.id);
    return { item: item.name, left: null, removed: true };
  }
  if (!input.amount || input.amount.quantity === null) return { item: item.name, left: null, removed: false, skipped: "no amount given" };
  const line = planLine('', item, input.amount);
  if (line.action === 'use_up') {
    removeFromPantry(item.id);
    return { item: item.name, left: null, removed: true };
  }
  if (line.action === 'unknown') {
    return {
      item: item.name,
      left: line.have,
      removed: false,
      skipped: item.pantry_quantity === null ? 'no amount recorded at home — mark it used up instead' : `can't take ${line.use_text} off ${line.have}`,
    };
  }
  db.prepare('UPDATE items SET pantry_quantity = ?, pantry_unit = ?, updated_at = ? WHERE id = ?').run(
    line.left!.quantity,
    line.left!.unit,
    new Date().toISOString(),
    item.id
  );
  return { item: item.name, left: line.left_text, removed: false };
}

/** Apply a reviewed cook plan: each line either comes off by its amount or is used up. */
export const applyUse = db.transaction((lines: { item_id: string; amount?: string | null; used_up?: boolean }[]): UseResult[] =>
  lines.map((l) => useFromPantry(l.item_id, { amount: l.amount ? parseAmount(l.amount) : null, usedUp: Boolean(l.used_up) }))
);
