import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { db } from './db';
import { v4 as uuid } from 'uuid';
import { loadRecipe } from './recipes';
import { listRecipes } from './routes/recipes';
import { nameKey, parseIngredient } from './ingredients';
import { addItem, ShoppingItemRow } from './shopping';
import { addToPantry, findItem, itemDetail, latestPricesByStore, listItems, removeFromPantry } from './items';
import { pricedItemFor, recipeCost } from './costing';
import { NeedLine, paidPricesFor } from './paid';
import { budgetProStatus, syncBudgetPro } from './budgetpro';
import { search, toResult, ProductResult } from './prices/search';
import { applyFilters, basisValue, Basis, sortByBasis, suspectIds } from './prices/compare';
import { basketTotals, matchItem } from './prices/basket';
import { listWatchlist, watchTerm } from './routes/prices';
import { STORES } from './prices/stores';

// MCP (Model Context Protocol) endpoint, so Claude (Desktop / Code), Gemini
// CLI or any other MCP client can check grocery prices and read the recipes,
// meal plan, shopping list and pantry. Stateless: a fresh server per request,
// same as BudgetPro's.

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function product(p: ProductResult) {
  return {
    id: p.id,
    store: p.storeName,
    name: p.name,
    brand: p.brand,
    size: p.sizeOverride ?? p.sizeText,
    price: p.price,
    was_price: p.wasPrice,
    promo: p.promo,
    per_item: p.perItem,
    per_measure: p.perMeasure,
    measure: p.measureLabel ? `per ${p.measureLabel}` : null,
    in_stock: p.inStock,
    url: p.url,
    price_updated: p.updatedAt,
  };
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentWeek(): { start: string; end: string } {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const start = isoDate(d);
  d.setDate(d.getDate() + 6);
  return { start, end: isoDate(d) };
}

function defaultListId(list?: string): string {
  if (list) {
    const row = db.prepare('SELECT id FROM shopping_lists WHERE id = ? OR name = ? COLLATE NOCASE').get(list, list) as { id: string } | undefined;
    if (!row) throw new Error(`No shopping list called "${list}"`);
    return row.id;
  }
  return (db.prepare('SELECT id FROM shopping_lists ORDER BY position, created_at LIMIT 1').get() as { id: string }).id;
}

function findRecipe(idOrName: string) {
  const row = db
    .prepare('SELECT id FROM recipes WHERE id = ? OR name = ? COLLATE NOCASE UNION ALL SELECT id FROM recipes WHERE name LIKE ? LIMIT 1')
    .get(idOrName, idOrName, `%${idOrName}%`) as { id: string } | undefined;
  return row ? loadRecipe(row.id) : null;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const basisArg = z
  .enum(['measure', 'item', 'pack'])
  .optional()
  .describe('Compare per kg/litre/100 sheets ("measure", default), per item in a multipack ("item"), or by shelf price ("pack")');

function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'kitchenaid', version: '0.2.0' },
    {
      instructions:
        'KitchenAid is a household kitchen app in South Africa (prices in rand, ZAR). It has recipes, a weekly meal plan ' +
        '(Monday–Sunday, slots breakfast/lunch/dinner/snack), shopping lists grouped by aisle, a pantry of what is at home ' +
        '(filled automatically from grocery slips logged in BudgetPro), and live grocery prices from Pick n Pay, Makro and ' +
        'Woolworths, plus prices you actually paid per shop (incl. Checkers and SPAR) from BudgetPro slips — see prices_paid. Each store is asked about a search term at most once a day; results are cached, so repeat questions are ' +
        'instant, but a first search takes a few seconds per store and a whole shopping list can take a minute. Store search is ' +
        'fuzzy: check that a product really is the thing asked for (e.g. "tomato" can return tomato sauce) and say which ' +
        'product and pack size a price is for. Unit prices (per kg / litre) are the fair comparison; watch for implausible ' +
        'sizes (flagged as suspect_size).',
    }
  );

  // ---------- prices ----------

  server.registerTool(
    'search_prices',
    {
      title: 'Search grocery prices',
      description:
        'Search Pick n Pay, Makro and Woolworths for a product and compare prices. Returns the cheapest per store and the ' +
        'best-value list, sorted by the chosen basis. Use include/exclude words to narrow fuzzy results ' +
        '(e.g. term "tomato", include "chopped", exclude "paste sauce").',
      inputSchema: {
        term: z.string().min(2).max(80).describe('What to search for, e.g. "chopped tomatoes 410g" or "toilet paper"'),
        include_words: z.string().optional().describe('Space-separated words that must all appear in the product name'),
        exclude_words: z.string().optional().describe('Space-separated words that must not appear'),
        basis: basisArg,
        stores: z.array(z.enum(['pnp', 'makro', 'woolworths'])).optional(),
        limit: z.number().int().min(1).max(50).optional().describe('How many products to list (default 15)'),
        refresh: z.boolean().optional().describe('Ignore the 24-hour cache and ask the stores again'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ term, include_words, exclude_words, basis, stores, limit, refresh }) => {
      const b: Basis = basis ?? 'measure';
      const res = await search(term, { force: refresh, stores });
      const filtered = sortByBasis(
        applyFilters(res.products, { includeWords: include_words ?? '', excludeWords: exclude_words ?? '', inStockOnly: false }),
        b
      );
      const suspects = suspectIds(filtered, b);
      const ranked = filtered.filter((p) => basisValue(p, b) != null && !suspects.has(p.id));
      const lead = ranked[0];
      const sameUnit = ranked.filter((p) => b !== 'measure' || p.measureLabel === lead?.measureLabel);
      return json({
        term: res.term,
        basis: b,
        stores: res.stores.map((s) => ({ store: s.name, results: s.count, cached_at: s.fetchedAt, error: s.error, paused_until: s.pausedUntil })),
        cheapest_per_store: STORES.map((s) => {
          const p = sameUnit.find((x) => x.store === s.id);
          return p ? { ...product(p), value: basisValue(p, b) } : { store: s.name, none: true };
        }),
        products: filtered.slice(0, limit ?? 15).map((p) => ({ ...product(p), suspect_size: suspects.has(p.id) || undefined })),
        total_matching: filtered.length,
      });
    }
  );

  server.registerTool(
    'price_history',
    {
      title: 'Price history of a product',
      description: 'Every price change seen for one store product (id from search_prices), oldest first.',
      inputSchema: { product_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ product_id }) => {
      const row = db.prepare('SELECT * FROM price_products WHERE id = ?').get(product_id);
      if (!row) throw new Error('Unknown product id');
      const history = db.prepare('SELECT price, seen_at FROM price_history WHERE product_id = ? ORDER BY seen_at').all(product_id);
      return json({ product: product(toResult(row)), history });
    }
  );

  server.registerTool(
    'price_shopping_list',
    {
      title: 'Price the shopping list at each store',
      description:
        'For every open item on a shopping list, finds the best matching product at each store (enough packs to cover the ' +
        'amount needed) and totals the basket per store plus the cheapest mix across stores. Picks are automatic — review ' +
        'them, and use the alternatives when a pick is the wrong kind of product. Can take a minute the first time each day.',
      inputSchema: {
        list: z.string().optional().describe('List name or id; default the first list'),
        alternatives: z.number().int().min(0).max(5).optional().describe('Runner-up products per store per item (default 2)'),
        max_items: z.number().int().min(1).max(60).optional().describe('Only price the first N items (default 40)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ list, alternatives, max_items }) => {
      const items = db
        .prepare('SELECT * FROM shopping_items WHERE list_id = ? AND checked = 0 ORDER BY created_at')
        .all(defaultListId(list)) as ShoppingItemRow[];
      const chosen = items.slice(0, max_items ?? 40);
      const matches = await Promise.all(
        chosen.map((i) => matchItem({ name: i.name, quantity: i.quantity, unit: i.unit }, { alternatives: alternatives ?? 2 }))
      );
      return json({
        totals: basketTotals(matches),
        items: matches.map((m, idx) => ({
          item: m.name,
          need: [chosen[idx].quantity, chosen[idx].unit].filter((x) => x !== null).join(' ') || null,
          search_term: m.term,
          stores: m.stores.map((s) => ({
            store: s.storeName,
            error: s.error ?? undefined,
            pick: s.best ? { ...product(s.best.product), packs: s.best.packs, cost: s.best.cost } : null,
            alternatives: s.alternatives.map((a) => ({ ...product(a.product), packs: a.packs, cost: a.cost })),
          })),
        })),
        not_priced: items.length > chosen.length ? items.slice(chosen.length).map((i) => i.name) : undefined,
      });
    }
  );

  server.registerTool(
    'prices_paid',
    {
      title: 'What you paid, per shop',
      description:
        'Prices from your own BudgetPro slips, per shop — including Checkers and SPAR, which have no online prices to search. ' +
        'Give an item name for its latest price at each shop, or list=true to total the open shopping list per shop from your ' +
        'last-paid prices (whole packs, enough for the amount needed).',
      inputSchema: { item: z.string().optional(), list: z.string().optional().describe('Shopping list name, or "default"') },
      annotations: { readOnlyHint: true },
    },
    async ({ item, list }) => {
      if (item) {
        const hit = findItem({ name: item }) ?? pricedItemFor(item);
        if (!hit) return json({ found: false });
        return json({ item: hit.name, latest_per_shop: latestPricesByStore(hit.id) });
      }
      const rows = db
        .prepare('SELECT item_id, name, quantity, unit FROM shopping_items WHERE list_id = ? AND checked = 0')
        .all(defaultListId(list && list !== 'default' ? list : undefined)) as NeedLine[];
      return json(paidPricesFor(rows));
    }
  );

  server.registerTool(
    'list_price_watchlist',
    { title: 'Watched price searches', description: 'Searches refreshed automatically every day.', annotations: { readOnlyHint: true } },
    async () => json(listWatchlist())
  );

  server.registerTool(
    'watch_price',
    {
      title: 'Watch a price search daily',
      description: 'Refresh a search every day in the background, keeping include/exclude filters and basis.',
      inputSchema: { term: z.string().min(2).max(80), include_words: z.string().optional(), exclude_words: z.string().optional(), basis: basisArg },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ term, include_words, exclude_words, basis }) =>
      json(watchTerm({ term, includeWords: include_words, excludeWords: exclude_words, basis }))
  );

  server.registerTool(
    'set_product_size',
    {
      title: 'Correct a product’s pack size',
      description: 'When a store listing has no size or a wrong one, set it (e.g. "9 rolls", "1.2 kg") so unit prices work. null clears it.',
      inputSchema: { product_id: z.string(), size: z.string().max(60).nullable() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ product_id, size }) => {
      const r = db
        .prepare('UPDATE price_products SET size_override = ?, updated_at = ? WHERE id = ?')
        .run(size?.trim() || null, new Date().toISOString(), product_id);
      if (!r.changes) throw new Error('Unknown product id');
      return json(product(toResult(db.prepare('SELECT * FROM price_products WHERE id = ?').get(product_id))));
    }
  );

  // ---------- recipes & plan ----------

  server.registerTool(
    'search_recipes',
    {
      title: 'Search recipes',
      description:
        'Recipes by name or ingredient, with how many of their ingredients are already at home (pantry + staples). ' +
        'Empty query lists everything.',
      inputSchema: { query: z.string().optional(), tag: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ query, tag }) => {
      return json(listRecipes({ q: query, tag }).map((r) => ({ id: r.id, name: r.name, tags: r.tags, servings: r.servings, total_minutes: r.total_minutes, favorite: r.favorite, ingredients: r.ingredient_count, have: r.have_count })));
    }
  );

  server.registerTool(
    'get_recipe',
    {
      title: 'Get a recipe',
      description: 'Full recipe — ingredients (raw and parsed), steps, servings, times, notes, source.',
      inputSchema: { recipe: z.string().describe('Recipe id or name') },
      annotations: { readOnlyHint: true },
    },
    async ({ recipe }) => {
      const r = findRecipe(recipe);
      if (!r) throw new Error(`No recipe matching "${recipe}"`);
      return json(r);
    }
  );

  server.registerTool(
    'get_meal_plan',
    {
      title: 'Get the meal plan',
      description: 'Planned meals between two dates (default: this week, Monday to Sunday).',
      inputSchema: { start: DATE.optional(), end: DATE.optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ start, end }) => {
      const week = currentWeek();
      return json(
        db
          .prepare('SELECT id, date, slot, title, recipe_id, servings, note FROM meal_plan WHERE date BETWEEN ? AND ? ORDER BY date, position')
          .all(start ?? week.start, end ?? week.end)
      );
    }
  );

  server.registerTool(
    'plan_meal',
    {
      title: 'Add to the meal plan',
      description: 'Plan a recipe (by id or name) or a free-text note ("Eating out") on a day.',
      inputSchema: {
        date: DATE,
        slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional().describe('Default dinner'),
        recipe: z.string().optional().describe('Recipe id or name'),
        note: z.string().optional().describe('Free text instead of a recipe'),
        servings: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ date, slot, recipe, note, servings }) => {
      const r = recipe ? findRecipe(recipe) : null;
      if (recipe && !r) throw new Error(`No recipe matching "${recipe}"`);
      const title = r?.name ?? note?.trim();
      if (!title) throw new Error('Give a recipe or a note');
      const s = slot ?? 'dinner';
      const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM meal_plan WHERE date = ? AND slot = ?').get(date, s) as { p: number }).p;
      const id = uuid();
      db.prepare('INSERT INTO meal_plan (id, date, slot, position, recipe_id, title, servings, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id,
        date,
        s,
        position,
        r?.id ?? null,
        title,
        servings ?? r?.servings ?? null,
        null,
        new Date().toISOString()
      );
      return json({ planned: { id, date, slot: s, title, servings: servings ?? r?.servings ?? null } });
    }
  );

  // ---------- shopping & pantry ----------

  server.registerTool(
    'get_shopping_list',
    {
      title: 'Get a shopping list',
      description: 'Items on a shopping list with amount, aisle and which recipes they came from.',
      inputSchema: { list: z.string().optional(), include_ticked: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ list, include_ticked }) => {
      const lists = db.prepare('SELECT id, name FROM shopping_lists ORDER BY position').all();
      const rows = db
        .prepare(
          `SELECT i.name, i.quantity, i.unit, i.note, i.sources, i.checked, c.name AS aisle FROM shopping_items i
           LEFT JOIN categories c ON c.id = i.category_id WHERE i.list_id = ? ${include_ticked ? '' : 'AND i.checked = 0'}
           ORDER BY c.position, i.created_at`
        )
        .all(defaultListId(list));
      return json({ lists, items: rows });
    }
  );

  server.registerTool(
    'add_to_shopping_list',
    {
      title: 'Add to the shopping list',
      description: 'Add items written naturally ("2 kg potatoes", "milk"). Items already on the list are topped up, not duplicated.',
      inputSchema: { items: z.array(z.string().min(1)).min(1).max(100), list: z.string().optional() },
      annotations: { readOnlyHint: false },
    },
    async ({ items, list }) => {
      const listId = defaultListId(list);
      const added = db.transaction(() =>
        items.map((text) => {
          const p = parseIngredient(text);
          const row = addItem(listId, { name: p.name, quantity: p.quantity, unit: p.unit, note: p.note, source: 'AI assistant' });
          return { name: row.name, quantity: row.quantity, unit: row.unit };
        })
      )();
      return json({ added });
    }
  );

  server.registerTool(
    'get_pantry',
    {
      title: 'What’s in the pantry',
      description:
        'Things at home, with when they were bought, where the line came from (budgetpro slip, shopping list, manual) and ' +
        'the last price paid (pack price, and unit_price per item / g / ml).',
      inputSchema: { query: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) =>
      json(
        listItems({ q: query, pantryOnly: true }).map((i) => ({
          name: i.name,
          aisle: i.category_name,
          amount: [i.pantry_quantity, i.pantry_unit].filter((x) => x !== null).join(' ') || null,
          bought: i.bought_at,
          from: i.pantry_source,
          last_paid: i.pack_price !== null ? { pack_price: i.pack_price, pack: i.pack_label, unit_price: i.unit_price, per: i.price_unit, on: i.price_at } : null,
        }))
      )
  );

  server.registerTool(
    'update_pantry',
    {
      title: 'Update the pantry',
      description: 'Add things now at home ("2 kg rice") and/or mark things used up (by name).',
      inputSchema: { add: z.array(z.string().min(1)).optional(), used_up: z.array(z.string().min(1)).optional() },
      annotations: { readOnlyHint: false },
    },
    async ({ add, used_up }) => {
      const added = (add ?? []).map((text) => {
        const p = parseIngredient(text);
        return addToPantry({ name: p.name, quantity: p.quantity, unit: p.unit, note: p.note, source: 'ai' }).name;
      });
      const removed: string[] = [];
      for (const name of used_up ?? []) {
        const item = findItem({ name });
        if (item?.in_pantry) {
          removeFromPantry(item.id);
          removed.push(item.name);
        }
      }
      return json({ added, removed });
    }
  );

  server.registerTool(
    'find_item',
    {
      title: 'Look up an item',
      description:
        'An item in the catalogue by name or barcode, with every barcode, slip spelling and other name linked to it ' +
        '(e.g. Knorr and Royco onion soup both under "Brown onion soup"), pantry state and last price paid.',
      inputSchema: { name: z.string().optional(), barcode: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ name, barcode }) => {
      const hit = findItem({ name, barcode });
      if (hit) return json({ ...itemDetail(hit.id), paid_per_shop: latestPricesByStore(hit.id) });
      return json({ found: false, similar: name ? listItems({ q: name }).slice(0, 10).map((i) => i.name) : [] });
    }
  );

  server.registerTool(
    'recipe_cost',
    {
      title: 'What a recipe costs to make',
      description:
        'Cost of a recipe at a number of servings, from the prices actually paid (BudgetPro slips) per item / g / ml — only ' +
        'the amount used, not whole packs. Ingredients never bought can be estimated from cached shop prices (use_store_prices).',
      inputSchema: {
        recipe: z.string().describe('Recipe id or name'),
        servings: z.number().int().min(1).max(100).optional(),
        use_store_prices: z.boolean().optional().describe('Fill gaps from cached Pick n Pay / Makro / Woolworths prices (default true)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, servings, use_store_prices }) => {
      const r = findRecipe(recipe);
      if (!r) throw new Error(`No recipe matching "${recipe}"`);
      return json(await recipeCost(r.id, servings ?? null, { storeFallback: use_store_prices !== false }));
    }
  );

  server.registerTool(
    'sync_budgetpro',
    {
      title: 'Pull new grocery slips from BudgetPro',
      description: 'Add grocery lines from new BudgetPro slips to the pantry and tick them off the shopping list. Runs every 30 minutes on its own.',
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async () => json(budgetProStatus().configured ? await syncBudgetPro() : { error: 'BudgetPro is not connected in the add-on configuration' })
  );

  return server;
}

export const mcpRouter = Router();

mcpRouter.post('/', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: (e as Error).message }, id: null });
    }
  }
});

// Stateless server: no SSE stream to resume, no session to delete.
mcpRouter.all('/', (_req, res) => {
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
});
