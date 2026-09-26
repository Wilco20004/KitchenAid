import { db } from '../db';
import { formatQuantity, nameKey, parseIngredient } from '../ingredients';
import { guessCategoryName } from '../categorize';
import { addAlias, findItem, rememberItem } from '../items';
import { saveRecipe } from '../recipes';
import { addItem } from '../shopping';
import { downloadImage, ImportError } from './fetch';
import { htmlToSteps } from './scrape';
import { v4 as uuid } from 'uuid';

// One-way move from Grocy: recipes (with pictures), the open shopping list,
// the meal plan, and every product name (so autocomplete and aisles already
// know your groceries). Reads only — nothing in Grocy is changed. Safe to
// run again: anything already brought over is skipped.

export interface GrocyImportOptions {
  url: string;
  api_key: string;
  recipes?: boolean;
  shopping?: boolean;
  mealplan?: boolean;
  products?: boolean;
}

export interface GrocyImportResult {
  recipes: number;
  shopping_items: number;
  meal_plan: number;
  products: number;
  barcodes: number;
  skipped: number;
  warnings: string[];
}

function baseUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/api$/i, '');
}

async function grocyGet<T>(base: string, key: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/${path}`, {
      headers: { 'GROCY-API-KEY': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e: any) {
    throw new ImportError(`Couldn't reach Grocy at ${base}: ${e.cause?.code || e.message}`);
  }
  if (res.status === 401) throw new ImportError('Grocy rejected the API key (HTTP 401).');
  if (!res.ok) throw new ImportError(`Grocy answered HTTP ${res.status} for ${path}.`);
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) {
    throw new ImportError(
      "That address returned a web page, not Grocy's API. Home Assistant Ingress links (…/a0d7b954_grocy) " +
        "can't be used from another add-on — use Grocy's own port instead, e.g. http://<your-HA-IP>:9192."
    );
  }
  return res.json() as Promise<T>;
}

const already = (externalId: string) =>
  (db.prepare('SELECT local_id FROM imported WHERE external_id = ?').get(externalId) as { local_id: string } | undefined)?.local_id;
const remember = (externalId: string, localId: string) =>
  db.prepare('INSERT OR REPLACE INTO imported (external_id, local_id) VALUES (?, ?)').run(externalId, localId);

// Grocy product groups are free text; map the usual ones onto our aisles.
const GROUP_HINTS: [RegExp, string][] = [
  [/meat|fish|poultry|butcher/i, 'Meat & Fish'],
  [/veg|fruit|produce/i, 'Fruit & Veg'],
  [/herb|spice/i, 'Herbs & Spices'],
  [/dairy|egg|milk|cheese/i, 'Dairy & Eggs'],
  [/starch|pantry|grain|baking|dry|tin|can/i, 'Pantry'],
  [/bread|bak/i, 'Bakery'],
  [/frozen|freez/i, 'Frozen'],
  [/drink|beverage/i, 'Drinks'],
  [/snack|sweet/i, 'Snacks'],
  [/clean|house|toilet/i, 'Household'],
  [/sauce|condiment/i, 'Sauces & Condiments'],
];

function categoryIdByName(name: string | null): string | null {
  if (!name) return null;
  const row = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name) as { id: string } | undefined;
  return row?.id ?? null;
}

export async function importFromGrocy(opts: GrocyImportOptions): Promise<GrocyImportResult> {
  if (!opts.url?.trim() || !opts.api_key?.trim()) throw new ImportError('Grocy address and API key are both needed.');
  const base = baseUrl(opts.url);
  const key = opts.api_key.trim();
  const get = <T>(path: string) => grocyGet<T>(base, key, path);
  const result: GrocyImportResult = { recipes: 0, shopping_items: 0, meal_plan: 0, products: 0, barcodes: 0, skipped: 0, warnings: [] };

  await get('system/info');
  const [products, units, groups] = await Promise.all([
    get<any[]>('objects/products'),
    get<any[]>('objects/quantity_units'),
    get<any[]>('objects/product_groups'),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const groupById = new Map(groups.map((g) => [g.id, g.name as string]));

  // "Gram" → g, "ml" → ml, "Pack" → packet; "Piece" means just a count.
  const unitById = new Map<number, string | null>();
  for (const u of units) {
    const parsed = parseIngredient(`1 ${u.name} x`).unit;
    unitById.set(u.id, parsed === 'piece' ? null : parsed ?? String(u.name).toLowerCase());
  }

  const productCategory = (product: any): string | null => {
    const groupName = product?.product_group_id ? groupById.get(product.product_group_id) : null;
    if (groupName) {
      const direct = categoryIdByName(groupName);
      if (direct) return direct;
      const hint = GROUP_HINTS.find(([re]) => re.test(groupName));
      if (hint) return categoryIdByName(hint[1]);
    }
    return categoryIdByName(guessCategoryName(nameKey(product?.name ?? '')) ?? 'Other');
  };

  if (opts.products !== false) {
    for (const p of products) {
      if (!p.name) continue;
      if (findItem({ name: p.name })) continue;
      rememberItem(p.name.trim(), productCategory(p), false);
      result.products++;
    }
    // Grocy keeps barcodes per product; they become the item's barcodes.
    const barcodes = await get<any[]>('objects/product_barcodes');
    for (const b of barcodes) {
      const product = productById.get(b.product_id);
      const code = String(b.barcode ?? '').trim();
      if (!product?.name || !code) continue;
      const item = rememberItem(product.name.trim(), productCategory(product), false);
      try {
        addAlias(item.id, 'barcode', code, b.note || product.name);
        result.barcodes++;
      } catch {
        // already linked to another item — leave it where it is
      }
    }
  }

  const recipeIdMap = new Map<number, string>();
  if (opts.recipes !== false || opts.mealplan !== false) {
    const [recipes, positions, nestings] = await Promise.all([
      get<any[]>('objects/recipes'),
      get<any[]>('objects/recipes_pos'),
      get<any[]>('objects/recipes_nestings'),
    ]);
    // Grocy stores meal-plan bookkeeping as fake recipes; only "normal" ones are real.
    const real = recipes.filter((r) => r.type === 'normal' && r.id > 0);
    const recipeById = new Map(recipes.map((r) => [r.id, r]));

    const lineFor = (pos: any, factor = 1): string => {
      const product = productById.get(pos.product_id);
      const name = product?.name?.trim() || pos.note || 'Unknown ingredient';
      const unit = unitById.get(pos.qu_id) ?? null;
      const qty = pos.variable_amount ? String(pos.variable_amount) : pos.amount ? formatQuantity(pos.amount * factor, unit) : '';
      const note = pos.note && product ? `, ${pos.note}` : '';
      return [qty, unit, name].filter(Boolean).join(' ') + note;
    };

    for (const r of real) {
      const ext = `grocy:recipe:${r.id}`;
      const existing = already(ext);
      if (existing) {
        recipeIdMap.set(r.id, existing);
        result.skipped++;
        continue;
      }
      if (opts.recipes === false) continue;

      const ingredients: { section: string | null; raw: string }[] = positions
        .filter((p) => p.recipe_id === r.id)
        .map((p) => ({ section: p.ingredient_group || null, raw: lineFor(p) }));
      // Included sub-recipes ("Make mash" inside "Chicken Mash Bowl") become their own section.
      for (const n of nestings.filter((n) => n.recipe_id === r.id)) {
        const sub = recipeById.get(n.includes_recipe_id);
        if (!sub) continue;
        const factor = sub.base_servings ? (n.servings || sub.base_servings) / sub.base_servings : 1;
        for (const p of positions.filter((p) => p.recipe_id === sub.id)) ingredients.push({ section: sub.name, raw: lineFor(p, factor) });
      }

      let image: string | null = null;
      if (r.picture_file_name) {
        const encoded = Buffer.from(r.picture_file_name, 'utf8').toString('base64');
        image = await downloadImage(`${base}/api/files/recipepictures/${encodeURIComponent(encoded)}?force_serve_as=picture&best_fit_width=1600`, {
          'GROCY-API-KEY': key,
        });
        if (!image) result.warnings.push(`Couldn't download the picture for "${r.name}".`);
      }

      const id = saveRecipe(
        {
          name: r.name,
          servings: r.base_servings || null,
          ingredients,
          steps: htmlToSteps(r.description || '').map((text) => ({ section: null, text })),
          tags: ['grocy'],
        },
        null,
        image
      );
      remember(ext, id);
      recipeIdMap.set(r.id, id);
      result.recipes++;
    }
  }

  if (opts.shopping !== false) {
    const items = await get<any[]>('objects/shopping_list');
    const list = db.prepare('SELECT id FROM shopping_lists ORDER BY position, created_at LIMIT 1').get() as { id: string };
    for (const item of items.filter((i) => !i.done)) {
      const ext = `grocy:shopping:${item.id}`;
      if (already(ext)) {
        result.skipped++;
        continue;
      }
      const product = productById.get(item.product_id);
      const name = product?.name?.trim() || item.note?.trim();
      if (!name) continue;
      const row = addItem(list.id, {
        name,
        quantity: item.amount || null,
        unit: unitById.get(item.qu_id) ?? null,
        note: product && item.note ? item.note : null,
        category_id: product ? productCategory(product) : null,
      });
      remember(ext, row.id);
      result.shopping_items++;
    }
  }

  if (opts.mealplan !== false) {
    const entries = await get<any[]>('objects/meal_plan');
    const now = new Date().toISOString();
    for (const e of entries) {
      const ext = `grocy:mealplan:${e.id}`;
      if (already(ext)) {
        result.skipped++;
        continue;
      }
      let recipeId: string | null = null;
      let title: string | null = null;
      if (e.type === 'recipe') {
        recipeId = recipeIdMap.get(e.recipe_id) ?? null;
        title = recipeId ? (db.prepare('SELECT name FROM recipes WHERE id = ?').get(recipeId) as { name: string }).name : null;
      } else if (e.type === 'product') {
        title = productById.get(e.product_id)?.name ?? null;
      } else {
        title = e.note?.trim() || null;
      }
      if (!title) continue;
      const id = uuid();
      db.prepare(
        'INSERT INTO meal_plan (id, date, slot, position, recipe_id, title, servings, note, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)'
      ).run(id, e.day, 'dinner', recipeId, title, e.recipe_servings || null, e.type === 'recipe' ? e.note || null : null, now);
      remember(ext, id);
      result.meal_plan++;
    }
  }

  return result;
}
