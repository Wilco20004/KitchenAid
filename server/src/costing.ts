import { db } from './db';
import { nameKey, toBase } from './ingredients';
import { findItem, ItemRow, wordsWithin } from './items';
import { search } from './prices/search';
import { isKitchenware, searchTerm } from './prices/basket';
import { sameProductForm } from './productForms';

// What a recipe costs to make, from what you actually paid: each ingredient
// is matched to an item in the catalogue and its amount multiplied by that
// item's unit price (eggs at R4 each, recipe wants 2 → R8). Ingredients never
// bought yet can fall back to today's cached store prices, marked as such.
// Only the amount used is counted, not the whole pack.

// Rough grams per millilitre, for recipes that measure by cup/spoon what
// was bought by weight. Anything not listed is treated like water.
const DENSITY: [string, number][] = [
  ['flour', 0.53],
  ['icing sugar', 0.5],
  ['brown sugar', 0.83],
  ['sugar', 0.85],
  ['rice', 0.8],
  ['oat', 0.4],
  ['butter', 0.96],
  ['oil', 0.92],
  ['honey', 1.4],
  ['cocoa', 0.45],
  ['cacao', 0.45],
  ['salt', 1.2],
  ['baking powder', 0.9],
  ['baking soda', 0.9],
  ['maize meal', 0.6],
  ['cheese', 0.45],
  ['breadcrumb', 0.45],
];

function density(key: string): { value: number; known: boolean } {
  const hit = DENSITY.find(([word]) => key.includes(word));
  return hit ? { value: hit[1], known: true } : { value: 1, known: false };
}

const COUNT_UNITS = new Set([null, 'piece', 'can', 'tin', 'packet', 'bottle', 'jar', 'bag', 'head', 'bunch', 'stick', 'sheet', 'slice']);

export interface CostLine {
  raw: string;
  item: string | null;
  cost: number | null;
  basis: 'paid' | 'store' | null;
  detail: string;
  approx?: boolean;
  price_at?: string | null;
}

interface Ingredient {
  raw: string;
  name: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `R${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

/** The priced item that best matches an ingredient name, if any. */
export function pricedItemFor(name: string): ItemRow | undefined {
  // What an item is: its name plus the pack it was priced from — a slip label
  // alone ("MIAMI 50G") often doesn't say it's tomato paste.
  const described = (i: ItemRow) => `${i.name} ${i.pack_label ?? ''}`;
  const exact = findItem({ name });
  if (exact?.unit_price != null && sameProductForm(name, described(exact))) return exact;
  const key = nameKey(name);
  const candidates = db.prepare('SELECT * FROM items WHERE unit_price IS NOT NULL').all() as ItemRow[];
  // "white sugar" ↔ "sugar" either way round; the closest word count wins.
  return candidates
    .filter((i) => (wordsWithin(key, i.name_key) || wordsWithin(i.name_key, key)) && sameProductForm(key, described(i)))
    .sort((a, b) => Math.abs(a.name_key.split(' ').length - key.split(' ').length) - Math.abs(b.name_key.split(' ').length - key.split(' ').length))[0];
}

function costFromUnitPrice(
  ing: Ingredient,
  qty: number,
  unitPrice: number,
  priceUnit: 'item' | 'g' | 'ml'
): { cost: number; detail: string; approx?: boolean } | { reason: string } {
  const base = toBase(qty, ing.unit);
  if (priceUnit === 'item') {
    if (COUNT_UNITS.has(ing.unit)) return { cost: qty * unitPrice, detail: `${qty} × ${money(unitPrice)} each` };
    return { reason: `bought by the item, recipe measures in ${ing.unit}` };
  }
  if (!base) return { reason: `priced per ${priceUnit}, recipe counts ${ing.unit ?? 'items'}` };
  let amount = base.amount;
  let approx = false;
  if (base.family === 'volume' && priceUnit === 'g') {
    const d = density(nameKey(ing.name));
    amount *= d.value;
    approx = true;
  } else if (base.family === 'mass' && priceUnit === 'ml') {
    amount /= density(nameKey(ing.name)).value;
    approx = true;
  }
  return { cost: amount * unitPrice, detail: `${Math.round(amount)} ${priceUnit} × ${money(unitPrice)}/${priceUnit}${approx ? ' (converted by volume)' : ''}`, approx };
}

async function storeEstimate(ing: Ingredient, qty: number): Promise<CostLine | null> {
  const term = searchTerm(ing.name);
  if (term.length < 2) return null;
  const res = await search(term, { cacheOnly: true });
  const words = nameKey(term).split(' ');
  const relevant = res.products.filter(
    (p) => p.rank < 20 && words.every((w) => `${p.brand ?? ''} ${p.name}`.toLowerCase().includes(w)) && !isKitchenware(p.name, term)
  );
  if (!relevant.length) return null;
  // Median unit price across stores: a fair "typical" price, not the one oddity.
  const pick = (vals: number[]) => vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)];
  const base = toBase(qty, ing.unit);
  if (base) {
    const label = base.family === 'mass' ? 'kg' : 'L';
    const per = relevant.filter((p) => p.measureLabel === label && p.perMeasure != null).map((p) => p.perMeasure!);
    if (per.length) {
      const perBase = pick(per) / 1000;
      return { raw: ing.raw, item: term, cost: r2(base.amount * perBase), basis: 'store', detail: `≈ ${money(pick(per))}/${label} in shops today` };
    }
  }
  if (COUNT_UNITS.has(ing.unit)) {
    const per = relevant.filter((p) => p.perItem != null).map((p) => p.perItem!);
    if (per.length) return { raw: ing.raw, item: term, cost: r2(qty * pick(per)), basis: 'store', detail: `≈ ${money(pick(per))} each in shops today` };
  }
  return null;
}

export async function recipeCost(recipeId: string, servings?: number | null, opts: { storeFallback?: boolean } = {}) {
  const recipe = db.prepare('SELECT name, servings FROM recipes WHERE id = ?').get(recipeId) as { name: string; servings: number | null } | undefined;
  if (!recipe) throw new Error('Recipe not found');
  const factor = recipe.servings && servings ? servings / recipe.servings : 1;
  const ingredients = db
    .prepare('SELECT raw, name, quantity, quantity_max, unit FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position')
    .all(recipeId) as Ingredient[];

  const lines: CostLine[] = [];
  for (const ing of ingredients) {
    if (ing.quantity === null) {
      lines.push({ raw: ing.raw, item: null, cost: null, basis: null, detail: 'no amount given' });
      continue;
    }
    // A range ("2–3 cloves") is costed at its midpoint.
    const qty = (ing.quantity_max !== null ? (ing.quantity + ing.quantity_max) / 2 : ing.quantity) * factor;
    const item = pricedItemFor(ing.name);
    if (item?.unit_price != null && item.price_unit) {
      const c = costFromUnitPrice(ing, qty, item.unit_price, item.price_unit);
      if ('cost' in c) {
        lines.push({ raw: ing.raw, item: item.name, cost: r2(c.cost), basis: 'paid', detail: c.detail, approx: c.approx, price_at: item.price_at });
        continue;
      }
      if (!opts.storeFallback) {
        lines.push({ raw: ing.raw, item: item.name, cost: null, basis: null, detail: c.reason });
        continue;
      }
    }
    const estimate = opts.storeFallback ? await storeEstimate(ing, qty) : null;
    lines.push(estimate ?? { raw: ing.raw, item: item?.name ?? null, cost: null, basis: null, detail: 'no price yet' });
  }

  const total = r2(lines.reduce((sum, l) => sum + (l.cost ?? 0), 0));
  const effectiveServings = servings ?? recipe.servings ?? null;
  return {
    recipe: recipe.name,
    servings: effectiveServings,
    total,
    per_serving: effectiveServings ? r2(total / effectiveServings) : null,
    priced: lines.filter((l) => l.cost !== null).length,
    unpriced: lines.filter((l) => l.cost === null).length,
    from_store_prices: lines.filter((l) => l.basis === 'store').length,
    lines,
  };
}
