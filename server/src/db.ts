import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';

import { DATA_DIR } from './paths';

export { DATA_DIR };

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'kitchenaid.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    servings INTEGER,
    prep_minutes INTEGER,
    cook_minutes INTEGER,
    total_minutes INTEGER,
    source_url TEXT,
    source_name TEXT,
    image_path TEXT,
    notes TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- raw is the line exactly as typed or imported; quantity/unit/name/note are
  -- what the parser made of it, used for scaling and for the shopping list.
  -- section groups lines under a heading ("For the sauce").
  CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    section TEXT,
    raw TEXT NOT NULL,
    quantity REAL,
    quantity_max REAL,
    unit TEXT,
    name TEXT NOT NULL,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS recipe_steps (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    section TEXT,
    text TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS recipe_tags (
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (recipe_id, tag_id)
  );

  -- One planned meal. Either a recipe (title keeps a copy of its name so the
  -- plan still reads sensibly if the recipe is later deleted) or just a note
  -- like "Leftovers" / "Eating out" with recipe_id NULL.
  CREATE TABLE IF NOT EXISTS meal_plan (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    servings INTEGER,
    note TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shopping_lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- Aisles, in the order you walk the shop.
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  -- sources is a " · "-joined list of recipe names this line came from.
  CREATE TABLE IF NOT EXISTS shopping_items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    quantity REAL,
    unit TEXT,
    note TEXT,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
    sources TEXT,
    checked INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- The item catalogue: one row per kind of thing you buy ("Brown onion
  -- soup", "Eggs"), however many brands, barcodes and slip spellings it has
  -- (those are item_aliases). Drives autocomplete and remembers the aisle.
  --
  -- It also IS the pantry: in_pantry = 1 means it's at home. Deliberately
  -- light — no expiry dates or stock levels like Grocy: it goes in when you
  -- buy it (a BudgetPro slip, or ticking it off the list) and out when used up.
  --
  -- unit_price is what it last cost per item / per gram / per ml
  -- (price_unit), worked out from the pack bought — R72 for "EGGS 18S" is
  -- R4 per egg — and is what recipe costing multiplies by.
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used TEXT,
    in_pantry INTEGER NOT NULL DEFAULT 0,
    pantry_quantity REAL,
    pantry_unit TEXT,
    pantry_note TEXT,
    pantry_source TEXT,
    bought_at TEXT,
    pack_price REAL,
    pack_label TEXT,
    unit_price REAL,
    price_unit TEXT,
    price_source TEXT,
    price_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Other ways of recognising an item. kind is one of:
  --   barcode  an EAN/UPC scanned or typed in (Knorr AND Royco's barcodes
  --            can both point at "Brown onion soup")
  --   name     another name typed for it (name_key of "royco onion soup")
  --   slip     how BudgetPro slips print it ("knorr brn onion soup")
  --   store    a Pick n Pay / Makro / Woolworths product id
  CREATE TABLE IF NOT EXISTS item_aliases (
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    label TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (kind, value)
  );
  CREATE INDEX IF NOT EXISTS idx_item_aliases_item ON item_aliases(item_id);

  -- Every price actually paid, per shop — mostly from BudgetPro slips. This
  -- is how Checkers and SPAR get compared: neither publishes prices a
  -- program may read, but your slips from them say exactly what things cost.
  -- store is the tidied merchant name ("Checkers", "SPAR", "Pick n Pay").
  CREATE TABLE IF NOT EXISTS item_prices (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    store TEXT,
    pack_price REAL NOT NULL,
    pack_label TEXT,
    unit_price REAL NOT NULL,
    price_unit TEXT NOT NULL,
    source TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    receipt_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_item_prices_item ON item_prices(item_id, store, seen_at);

  -- Things you always have (salt, oil, water): unticked by default when a
  -- recipe's ingredients go to the shopping list.
  CREATE TABLE IF NOT EXISTS staples (
    name_key TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  -- Rows brought in from elsewhere (Grocy), so running an import twice
  -- doesn't duplicate anything. external_id is e.g. "grocy:recipe:12".
  CREATE TABLE IF NOT EXISTS imported (
    external_id TEXT PRIMARY KEY,
    local_id TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON recipe_ingredients(recipe_id, position);
  CREATE INDEX IF NOT EXISTS idx_steps_recipe ON recipe_steps(recipe_id, position);
  CREATE INDEX IF NOT EXISTS idx_recipe_tags_tag ON recipe_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_meal_plan_date ON meal_plan(date);
  CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_items(list_id);
  CREATE INDEX IF NOT EXISTS idx_recipes_source ON recipes(source_url);

  -- Small key/value store for app settings (the MCP token, sync cursors).
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- ---------- Prices (formerly the PriceScout add-on) ----------

  -- One row per store product ever seen. id is "<store>:<store's own id>" so
  -- the same product found by two different searches is stored once.
  CREATE TABLE IF NOT EXISTS price_products (
    id TEXT PRIMARY KEY,
    store TEXT NOT NULL,
    store_product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    brand TEXT,
    size_text TEXT,
    -- A size typed in by hand when the store's listing has none or a wrong
    -- one; wins over size_text.
    size_override TEXT,
    price REAL NOT NULL,
    -- Sold by weight (loose bananas): price is already per kg.
    priced_per_kg INTEGER NOT NULL DEFAULT 0,
    was_price REAL,
    promo TEXT,
    url TEXT,
    image_url TEXT,
    in_stock INTEGER,
    first_seen TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- The 24-hour cache: when each store was last asked about each term.
  -- term_key is the lower-cased, space-collapsed term.
  CREATE TABLE IF NOT EXISTS price_searches (
    store TEXT NOT NULL,
    term_key TEXT NOT NULL,
    term TEXT NOT NULL,
    fetched_at TEXT,
    error TEXT,
    error_at TEXT,
    PRIMARY KEY (store, term_key)
  );

  -- What a store returned for a term, in the store's own order.
  CREATE TABLE IF NOT EXISTS price_search_results (
    store TEXT NOT NULL,
    term_key TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES price_products(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    PRIMARY KEY (store, term_key, product_id)
  );

  -- A row only when a product's price changes, so it stays small.
  CREATE TABLE IF NOT EXISTS price_history (
    product_id TEXT NOT NULL REFERENCES price_products(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, seen_at);

  -- Terms refreshed in the background every day, whether searched or not,
  -- with the filters they were starred with ("toilet paper" minus wet wipes).
  CREATE TABLE IF NOT EXISTS price_watchlist (
    term_key TEXT PRIMARY KEY,
    term TEXT NOT NULL,
    include_words TEXT NOT NULL DEFAULT '',
    exclude_words TEXT NOT NULL DEFAULT '',
    basis TEXT NOT NULL DEFAULT 'measure',
    created_at TEXT NOT NULL
  );
`);

// First run: a default list, a sensible aisle order, and a few staples.
const now = new Date().toISOString();
if (!(db.prepare('SELECT 1 FROM shopping_lists LIMIT 1').get())) {
  db.prepare('INSERT INTO shopping_lists (id, name, position, created_at) VALUES (?, ?, 0, ?)').run(uuid(), 'Groceries', now);
}

export const DEFAULT_CATEGORIES = [
  'Fruit & Veg',
  'Meat & Fish',
  'Dairy & Eggs',
  'Bakery',
  'Pantry',
  'Herbs & Spices',
  'Sauces & Condiments',
  'Frozen',
  'Drinks',
  'Snacks',
  'Household',
  'Other',
];
if (!(db.prepare('SELECT 1 FROM categories LIMIT 1').get())) {
  const insert = db.prepare('INSERT INTO categories (id, name, position) VALUES (?, ?, ?)');
  DEFAULT_CATEGORIES.forEach((name, i) => insert.run(uuid(), name, i));
  const staple = db.prepare('INSERT OR IGNORE INTO staples (name_key, name) VALUES (?, ?)');
  for (const [key, name] of [
    ['salt', 'Salt'],
    ['pepper', 'Pepper'],
    ['black pepper', 'Black pepper'],
    ['water', 'Water'],
    ['olive oil', 'Olive oil'],
    ['vegetable oil', 'Vegetable oil'],
    ['ice', 'Ice'],
  ]) {
    staple.run(key, name);
  }
}
