import { v4 as uuid } from 'uuid';
import { db } from './db';
import { addAmounts, nameKey, SIZE_WORDS } from './ingredients';
import { guessCategoryName } from './categorize';
import { parsePackSize } from './prices/units';
import { differentProduct } from './productForms';
import { addPantryAmounts, packContents } from './amounts';

// The item catalogue (see the items / item_aliases tables in db.ts): finding
// "the same thing" across names, barcodes and slip spellings, the pantry
// flag, and what each item last cost.

export interface ItemRow {
  id: string;
  name: string;
  name_key: string;
  category_id: string | null;
  use_count: number;
  last_used: string | null;
  in_pantry: number;
  pantry_quantity: number | null;
  pantry_unit: string | null;
  pantry_note: string | null;
  pantry_source: string | null;
  bought_at: string | null;
  expires_at: string | null;
  keeps_days: number | null;
  pack_price: number | null;
  pack_label: string | null;
  unit_price: number | null;
  price_unit: 'item' | 'g' | 'ml' | null;
  price_source: string | null;
  price_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AliasKind = 'barcode' | 'name' | 'slip' | 'store';

const now = () => new Date().toISOString();
const words = (key: string) => key.split(' ').filter(Boolean);

/** Every word of `small` appears in `big` ("milk" ⊆ "full cream milk"). */
export function wordsWithin(small: string, big: string): boolean {
  const b = new Set(words(big));
  const s = words(small);
  return s.length > 0 && s.every((w) => b.has(w));
}

export function getItem(id: string): ItemRow | undefined {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
}

function aliasItem(kind: AliasKind, value: string): ItemRow | undefined {
  return db
    .prepare('SELECT i.* FROM item_aliases a JOIN items i ON i.id = a.item_id WHERE a.kind = ? AND a.value = ?')
    .get(kind, value) as ItemRow | undefined;
}

/** An existing item by exact name, other name, or barcode — never creates one. */
export function findItem(q: { name?: string | null; barcode?: string | null }): ItemRow | undefined {
  if (q.barcode) {
    const hit = aliasItem('barcode', q.barcode.trim());
    if (hit) return hit;
  }
  if (q.name?.trim()) {
    const key = nameKey(q.name);
    return (db.prepare('SELECT * FROM items WHERE name_key = ?').get(key) as ItemRow | undefined) ?? aliasItem('name', key);
  }
  return undefined;
}

/** The item for this name, created (with a guessed aisle) if it's new. */
export function ensureItem(name: string, categoryId?: string | null): ItemRow {
  const existing = findItem({ name });
  if (existing) return existing;
  const id = uuid();
  const ts = now();
  db.prepare('INSERT INTO items (id, name, name_key, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    name.trim(),
    nameKey(name),
    categoryId === undefined ? guessCategoryId(nameKey(name)) : categoryId,
    ts,
    ts
  );
  return getItem(id)!;
}

function categoryIdByName(name: string): string | null {
  return (db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name) as { id: string } | undefined)?.id ?? null;
}

function guessCategoryId(key: string): string | null {
  return categoryIdByName(guessCategoryName(key) ?? 'Other') ?? categoryIdByName('Other');
}

/** Remembered aisle, else keyword guess, else "Other". */
export function categoryFor(key: string): string | null {
  const item = (db.prepare('SELECT category_id FROM items WHERE name_key = ?').get(key) ??
    db.prepare("SELECT i.category_id FROM item_aliases a JOIN items i ON i.id = a.item_id WHERE a.kind = 'name' AND a.value = ?").get(key)) as
    | { category_id: string | null }
    | undefined;
  return item?.category_id ?? guessCategoryId(key);
}

/** Note that an item was used (autocomplete ranks by this) and, if given, the aisle you filed it under. */
export function rememberItem(name: string, categoryId: string | null, bump = true): ItemRow {
  const item = ensureItem(name, categoryId ?? undefined);
  db.prepare('UPDATE items SET category_id = COALESCE(?, category_id), use_count = use_count + ?, last_used = ?, updated_at = ? WHERE id = ?').run(
    categoryId,
    bump ? 1 : 0,
    bump ? now() : item.last_used,
    now(),
    item.id
  );
  return getItem(item.id)!;
}

export function addAlias(itemId: string, kind: AliasKind, value: string, label?: string | null) {
  const v = kind === 'name' ? nameKey(value) : kind === 'slip' ? slipKey(value) : value.trim();
  if (!v) throw new Error('Nothing to link');
  const owner = db.prepare('SELECT item_id FROM item_aliases WHERE kind = ? AND value = ?').get(kind, v) as { item_id: string } | undefined;
  if (owner && owner.item_id !== itemId) {
    const other = getItem(owner.item_id);
    throw new Error(`That ${kind} already belongs to “${other?.name}” — merge the two items instead.`);
  }
  if (kind === 'name') {
    const clash = db.prepare('SELECT id, name FROM items WHERE name_key = ? AND id != ?').get(v, itemId) as { name: string } | undefined;
    if (clash) throw new Error(`“${clash.name}” is its own item — merge the two items instead.`);
  }
  db.prepare('INSERT OR REPLACE INTO item_aliases (kind, value, item_id, label, created_at) VALUES (?, ?, ?, ?, ?)').run(
    kind,
    v,
    itemId,
    label ?? (kind === 'name' ? value.trim() : null),
    now()
  );
}

export function removeAlias(kind: AliasKind, value: string) {
  db.prepare('DELETE FROM item_aliases WHERE kind = ? AND value = ?').run(kind, value);
}

/**
 * Fold one item into another ("Royco brown onion soup" into "Brown onion
 * soup"): its barcodes, slip names and other names move across, its own name
 * becomes another name for the target, shopping lines and pantry state follow.
 */
export const mergeItems = db.transaction((fromId: string, intoId: string): ItemRow => {
  if (fromId === intoId) throw new Error('Pick a different item to merge into');
  const from = getItem(fromId);
  const into = getItem(intoId);
  if (!from || !into) throw new Error('Item not found');
  db.prepare('UPDATE OR REPLACE item_aliases SET item_id = ? WHERE item_id = ?').run(intoId, fromId);
  db.prepare('UPDATE shopping_items SET item_id = ?, name_key = ? WHERE item_id = ? OR name_key = ?').run(intoId, into.name_key, fromId, from.name_key);
  // The newer price and the pantry state win, whichever side they're on.
  const newerPrice = (from.price_at ?? '') > (into.price_at ?? '');
  db.prepare(
    `UPDATE items SET
       in_pantry = MAX(in_pantry, ?), bought_at = MAX(COALESCE(bought_at, ''), COALESCE(?, '')),
       pantry_quantity = COALESCE(pantry_quantity, ?), pantry_unit = COALESCE(pantry_unit, ?),
       expires_at = CASE WHEN expires_at IS NULL OR ? < expires_at THEN COALESCE(?, expires_at) ELSE expires_at END,
       keeps_days = COALESCE(keeps_days, ?),
       use_count = use_count + ?, category_id = COALESCE(category_id, ?),
       pack_price = CASE WHEN ? THEN ? ELSE pack_price END, pack_label = CASE WHEN ? THEN ? ELSE pack_label END,
       unit_price = CASE WHEN ? THEN ? ELSE unit_price END, price_unit = CASE WHEN ? THEN ? ELSE price_unit END,
       price_source = CASE WHEN ? THEN ? ELSE price_source END, price_at = CASE WHEN ? THEN ? ELSE price_at END,
       updated_at = ?
     WHERE id = ?`
  ).run(
    from.in_pantry,
    from.bought_at,
    from.pantry_quantity,
    from.pantry_unit,
    from.expires_at,
    from.expires_at,
    from.keeps_days,
    from.use_count,
    from.category_id,
    ...[from.pack_price, from.pack_label, from.unit_price, from.price_unit, from.price_source, from.price_at].flatMap((v) => [
      newerPrice ? 1 : 0,
      v,
    ]),
    now(),
    intoId
  );
  db.prepare("UPDATE items SET bought_at = NULLIF(bought_at, '') WHERE id = ?").run(intoId);
  db.prepare('DELETE FROM items WHERE id = ?').run(fromId);
  db.prepare("INSERT OR REPLACE INTO item_aliases (kind, value, item_id, label, created_at) VALUES ('name', ?, ?, ?, ?)").run(
    from.name_key,
    intoId,
    from.name,
    now()
  );
  return getItem(intoId)!;
});

/** Delete an item with its barcodes, names and prices; shopping lines keep their text. */
export function deleteItem(id: string): boolean {
  return db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
}

/** Put the item's "last price" back to its newest remaining price (or none). */
export function refreshLatestPrice(itemId: string) {
  const p = db
    .prepare('SELECT pack_price, pack_label, unit_price, price_unit, source, seen_at FROM item_prices WHERE item_id = ? ORDER BY seen_at DESC, rowid DESC LIMIT 1')
    .get(itemId) as { pack_price: number; pack_label: string; unit_price: number; price_unit: string; source: string; seen_at: string } | undefined;
  db.prepare(
    'UPDATE items SET pack_price = ?, pack_label = ?, unit_price = ?, price_unit = ?, price_source = ?, price_at = ?, updated_at = ? WHERE id = ?'
  ).run(p?.pack_price ?? null, p?.pack_label ?? null, p?.unit_price ?? null, p?.price_unit ?? null, p?.source ?? null, p?.seen_at ?? null, now(), itemId);
}

// ---------- pantry ----------

export function pantryKeys(): string[] {
  return (
    db
      .prepare(
        `SELECT name_key FROM items WHERE in_pantry = 1
         UNION SELECT a.value FROM item_aliases a JOIN items i ON i.id = a.item_id WHERE i.in_pantry = 1 AND a.kind = 'name'`
      )
      .all() as { name_key: string }[]
  ).map((r) => r.name_key);
}

/**
 * Is this recipe ingredient already at home? "milk" is covered by "full
 * cream milk", but "chicken breast" isn't covered by just "chicken".
 */
export function pantryCovers(key: string, keys: string[]): boolean {
  return keys.some((p) => p === key || wordsWithin(key, p));
}

export function addToPantry(input: {
  name?: string;
  itemId?: string;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
  source?: string;
  bought_at?: string | null;
  expires_at?: string | null;
  /** The label of the pack bought, when it says how big a pack is ("MIAMI 50G"). */
  pack_label?: string | null;
}): ItemRow {
  const item = input.itemId ? getItem(input.itemId) : ensureItem(input.name!);
  if (!item) throw new Error('Item not found');
  const boughtAt = input.bought_at ?? now().slice(0, 10);
  // Buying more of something already at home: add up when the units allow,
  // otherwise the newest amount wins.
  const incoming = { quantity: input.quantity ?? null, unit: input.unit ?? null };
  const pack = packContents(input.pack_label) ?? packContents(item.pack_label);
  const amount = item.in_pantry
    ? addPantryAmounts({ quantity: item.pantry_quantity, unit: item.pantry_unit }, incoming, item.name, pack) ??
      addAmounts({ quantity: item.pantry_quantity, unit: item.pantry_unit }, incoming) ??
      incoming
    : incoming;
  // Its use-by date: given, or worked out from how long it usually keeps.
  // What was already at home goes off first, so the earlier date stays.
  const expiry = input.expires_at ?? (item.keeps_days ? addDays(boughtAt, item.keeps_days) : null);
  const expiresAt = item.in_pantry ? earlier(item.expires_at, expiry) : expiry;
  db.prepare(
    `UPDATE items SET in_pantry = 1, pantry_quantity = ?, pantry_unit = ?, pantry_note = COALESCE(?, pantry_note),
       pantry_source = ?, bought_at = MAX(COALESCE(bought_at, ''), ?), expires_at = ?, updated_at = ? WHERE id = ?`
  ).run(amount.quantity, amount.unit, input.note ?? null, input.source ?? 'manual', boughtAt, expiresAt, now(), item.id);
  return getItem(item.id)!;
}

// ---------- expiry ----------

export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));

/** Today as YYYY-MM-DD in the add-on's own time zone. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** Whole days from today to a date: 0 today, negative once past. */
export function daysLeft(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000);
}

function earlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Set the use-by date of what's at home and/or how long the item usually
 * keeps. A new keeps-for fills in a missing date from when it was bought.
 */
export function setExpiry(itemId: string, input: { expires_at?: string | null; keeps_days?: number | null }): ItemRow {
  const item = getItem(itemId);
  if (!item) throw new Error('Item not found');
  if (input.expires_at != null && !isDate(input.expires_at)) throw new Error('Use-by date must be YYYY-MM-DD');
  if (input.keeps_days != null && !(Number.isInteger(input.keeps_days) && input.keeps_days > 0 && input.keeps_days <= 3650)) {
    throw new Error('Keeps for must be a whole number of days');
  }
  const keeps = input.keeps_days !== undefined ? input.keeps_days : item.keeps_days;
  let expires = input.expires_at !== undefined ? input.expires_at : item.expires_at;
  if (input.expires_at === undefined && input.keeps_days && item.in_pantry && !item.expires_at) {
    expires = addDays(item.bought_at ?? today(), input.keeps_days);
  }
  db.prepare('UPDATE items SET expires_at = ?, keeps_days = ?, updated_at = ? WHERE id = ?').run(expires, keeps, now(), itemId);
  return getItem(itemId)!;
}

/** What's at home and past, or within `days` of, its use-by date — soonest first. */
export function expiringItems(days = 7) {
  return db
    .prepare(
      `SELECT i.*, c.name AS category_name FROM items i LEFT JOIN categories c ON c.id = i.category_id
       WHERE i.in_pantry = 1 AND i.expires_at IS NOT NULL AND i.expires_at <= ? ORDER BY i.expires_at, i.name COLLATE NOCASE`
    )
    .all(addDays(today(), days)) as (ItemRow & { category_name: string | null })[];
}

export function removeFromPantry(itemId: string) {
  db.prepare(
    'UPDATE items SET in_pantry = 0, pantry_quantity = NULL, pantry_unit = NULL, pantry_note = NULL, expires_at = NULL, updated_at = ? WHERE id = ?'
  ).run(now(), itemId);
}

// ---------- prices paid ----------

/**
 * Record what a pack cost and work out the unit price from its size:
 * "EGGS 18S" at R72 → R4 per item; "BEEF MINCE 1.2KG" at R150 → R0.125 per g.
 */
export function unitPriceOf(packPrice: number, packLabel: string): { unitPrice: number; priceUnit: 'item' | 'g' | 'ml' } {
  const size = parsePackSize(packLabel);
  if ((size.unit === 'g' || size.unit === 'ml') && (size.perKg || size.each)) {
    const total = size.perKg ? 1000 : size.count * (size.each ?? 0);
    return { unitPrice: packPrice / total, priceUnit: size.unit };
  }
  return { unitPrice: packPrice / Math.max(1, size.count), priceUnit: 'item' };
}

/** "SHOPRITE CHECKERS HYPER MENLYN" → "Checkers"; unknown shops keep their own name. */
export function storeName(merchant: string | null | undefined): string | null {
  const m = (merchant ?? '').trim();
  if (!m) return null;
  const known: [RegExp, string][] = [
    [/checkers/i, 'Checkers'],
    [/shoprite/i, 'Shoprite'],
    [/\bspar\b|superspar|kwikspar/i, 'SPAR'],
    [/pick ?n ?pay|\bpnp\b/i, 'Pick n Pay'],
    [/woolworths|\bww\b/i, 'Woolworths'],
    [/makro/i, 'Makro'],
    [/food lover/i, "Food Lover's Market"],
    [/boxer/i, 'Boxer'],
    [/usave/i, 'Usave'],
    [/dis-?chem/i, 'Dis-Chem'],
    [/clicks/i, 'Clicks'],
  ];
  return known.find(([re]) => re.test(m))?.[1] ?? m.replace(/\s+/g, ' ');
}

/**
 * Record what a pack cost and work out the unit price from its size:
 * "EGGS 18S" at R72 → R4 per item; "BEEF MINCE 1.2KG" at R150 → R0.125 per g.
 * The item keeps its newest price (recipe costing uses it); every price is
 * also kept per shop in item_prices.
 */
export function setPackPrice(
  itemId: string,
  packPrice: number,
  packLabel: string,
  source: string,
  at?: string,
  opts: { store?: string | null; receiptId?: string | null; historyOnly?: boolean } = {}
) {
  const { unitPrice, priceUnit } = unitPriceOf(packPrice, packLabel);
  const seenAt = at ?? now().slice(0, 10);
  db.prepare(
    `INSERT INTO item_prices (id, item_id, store, pack_price, pack_label, unit_price, price_unit, source, seen_at, receipt_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uuid(), itemId, opts.store ?? null, packPrice, packLabel, unitPrice, priceUnit, source, seenAt, opts.receiptId ?? null);
  const item = getItem(itemId)!;
  if (!opts.historyOnly || !item.price_at || seenAt >= item.price_at) {
    db.prepare(
      'UPDATE items SET pack_price = ?, pack_label = ?, unit_price = ?, price_unit = ?, price_source = ?, price_at = ?, updated_at = ? WHERE id = ?'
    ).run(packPrice, packLabel, unitPrice, priceUnit, source, seenAt, now(), itemId);
  }
  return getItem(itemId)!;
}

export interface PaidPrice {
  store: string | null;
  pack_price: number;
  pack_label: string | null;
  unit_price: number;
  price_unit: 'item' | 'g' | 'ml';
  seen_at: string;
  source: string;
}

/** The latest price paid at each shop for an item, newest first. */
export function latestPricesByStore(itemId: string): PaidPrice[] {
  return db
    .prepare(
      `SELECT p.store, p.pack_price, p.pack_label, p.unit_price, p.price_unit, p.seen_at, p.source FROM item_prices p
       WHERE p.item_id = ? AND p.rowid = (
         SELECT q.rowid FROM item_prices q WHERE q.item_id = p.item_id AND COALESCE(q.store, '') = COALESCE(p.store, '')
         ORDER BY q.seen_at DESC, q.rowid DESC LIMIT 1)
       ORDER BY p.seen_at DESC`
    )
    .all(itemId) as PaidPrice[];
}

// ---------- slip lines ----------

// Store brands and slip noise that say nothing about what the thing is.
const SLIP_NOISE = new Set([
  'pnp', 'pick', 'n', 'pay', 'ww', 'woolworths', 'woolies', 'checkers', 'shoprite', 'ritebrand', 'housebrand', 'house',
  'brand', 'no', 'name', 'makro', 'spar', 'freshline', 'simple', 'truth', 'ea', 'each', 'pk', 'pack', 'x',
]);

/** The words on a slip line that say what the thing is: "PNP EXTRA LARGE EGGS 18S" → ["eggs"]. */
function slipWords(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)?\s*(?:kg|g|gr|ml|l|lt|ltr|s|'s|pk|x)\b/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !SLIP_NOISE.has(w) && !SIZE_WORDS.has(w));
}

/** Matching key for a slip line, singular like item keys: "eggs" → "egg". */
export function slipKey(raw: string): string {
  return slipWords(raw)
    .map((w) => nameKey(w))
    .join(' ');
}

const titleCase = (s: string) => s.replace(/\b([a-z])([a-z]*)/g, (_m, a: string, b: string) => a.toUpperCase() + b);

/**
 * The item a slip line is for. A slip spelling seen before (or linked by
 * hand) is recognised straight away; otherwise the item whose name's words
 * all appear on the line wins ("PNP FRESH FULL CREAM MILK 2L" → "Milk"), and
 * failing that a new item is made from the tidied slip text. The spelling is
 * remembered either way, so fixing a wrong guess once fixes it for good.
 */
export function itemForSlipLine(raw: string): ItemRow {
  const key = slipKey(raw);
  const known = key ? aliasItem('slip', key) : undefined;
  if (known) return known;
  let item: ItemRow | undefined;
  if (key) {
    const candidates = db
      .prepare("SELECT id, name_key AS k FROM items UNION ALL SELECT item_id AS id, value AS k FROM item_aliases WHERE kind = 'name'")
      .all() as { id: string; k: string }[];
    // The thing itself is usually the last word ("full cream MILK"), so an
    // item ending in that word beats one that merely appears ("cream").
    const head = words(key).at(-1);
    const endsRight = (k: string) => (words(k).at(-1) === head ? 1 : 0);
    const match = candidates
      // …but never across product forms: "potato" isn't "potato chips".
      .filter((c) => c.k.length >= 3 && wordsWithin(c.k, key) && !differentProduct(c.k, raw))
      .sort((a, b) => endsRight(b.k) - endsRight(a.k) || words(b.k).length - words(a.k).length || b.k.length - a.k.length)[0];
    item = match ? getItem(match.id) : undefined;
  }
  // A new item keeps the slip's own wording, plural and all: "Eggs", not "Egg".
  item ??= ensureItem(titleCase(slipWords(raw).join(' ') || raw.toLowerCase().trim()));
  if (key) addAlias(item.id, 'slip', raw, raw.trim());
  return item;
}

// ---------- lists ----------

export function listItems(opts: { q?: string; pantryOnly?: boolean } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.pantryOnly) where.push('i.in_pantry = 1');
  if (opts.q?.trim()) {
    where.push("(i.name LIKE ? OR i.id IN (SELECT item_id FROM item_aliases WHERE value LIKE ? OR label LIKE ?))");
    const like = `%${opts.q.trim()}%`;
    params.push(like, `%${nameKey(opts.q)}%`, like);
  }
  return db
    .prepare(
      `SELECT i.*, c.name AS category_name, (SELECT COUNT(*) FROM item_aliases a WHERE a.item_id = i.id AND a.kind = 'barcode') AS barcode_count
       FROM items i LEFT JOIN categories c ON c.id = i.category_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.name COLLATE NOCASE`
    )
    .all(...params) as (ItemRow & { category_name: string | null; barcode_count: number })[];
}

export function itemDetail(id: string) {
  const item = getItem(id);
  if (!item) return null;
  return {
    ...item,
    aliases: db.prepare('SELECT kind, value, label, created_at FROM item_aliases WHERE item_id = ? ORDER BY kind, created_at').all(id),
  };
}
