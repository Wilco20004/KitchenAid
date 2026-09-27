import { v4 as uuid } from 'uuid';
import { db } from './db';
import { nameKey } from './ingredients';
import {
  addToPantry,
  deleteItem,
  ensureItem,
  findItem,
  getItem,
  ItemRow,
  refreshLatestPrice,
  rememberedPack,
  slipKey,
  unitPriceFor,
  usualPack,
  wordsWithin,
} from './items';
import { parsePackSize } from './prices/units';
import { contentsFrom } from './amounts';

// The slip review sheet: grocery lines from new BudgetPro slips wait here
// instead of going straight into the pantry, so "2 × BONNITA BUTTER" can be
// told it's two 500 g bricks. Each answer is remembered on that slip spelling
// (and so for the item), so the next slip arrives already filled in and
// checking it is one tap.

export interface SlipLineRow {
  id: string;
  receipt_id: string;
  store: string | null;
  bought_at: string;
  raw_name: string;
  quantity: number;
  amount: number;
  item_id: string | null;
  status: 'pending' | 'added' | 'skipped';
  created_at: string;
  done_at: string | null;
}

export interface PackGuess {
  quantity: number | null;
  unit: string | null;
  /** remembered: you said so before (this spelling or this item); label: read off the slip; guess: a plain pack. */
  from: 'remembered' | 'label' | 'guess' | 'loose';
}

const LOOSE = /(^|\s)(kg|lse|loose)(\s|$)/i;

/**
 * Loose produce weighed at the till ("BANANA KG", "GARLIC LSE KG"): the
 * slip's amount is for however much was in the bag, not for one of them.
 */
export function looseLine(raw: string): boolean {
  if (!LOOSE.test(raw)) return false;
  const size = parsePackSize(raw);
  return size.each === null || size.perKg;
}

/** What one pack of this slip line probably is, in pantry terms. */
export function guessPack(raw: string, itemId: string | null, quantity: number): PackGuess {
  // Loose produce: a fractional quantity is the weight in kg; a whole one says nothing. The
  // answer is this bag's weight, so it isn't remembered for next time.
  if (looseLine(raw)) return Number.isInteger(quantity) ? { quantity: null, unit: null, from: 'loose' } : { quantity, unit: 'kg', from: 'loose' };
  const remembered = rememberedPack(raw);
  if (remembered) return { ...remembered, from: 'remembered' };
  const size = parsePackSize(raw);
  if (size.each !== null && (size.unit === 'g' || size.unit === 'ml')) {
    const total = size.count * size.each;
    if (size.unit === 'g') return total >= 1000 ? { quantity: total / 1000, unit: 'kg', from: 'label' } : { quantity: total, unit: 'g', from: 'label' };
    return total >= 1000 ? { quantity: total / 1000, unit: 'l', from: 'label' } : { quantity: total, unit: 'ml', from: 'label' };
  }
  if (size.count > 1 && size.each === null) return { quantity: size.count, unit: 'piece', from: 'label' };
  const usual = usualPack(itemId);
  if (usual) return { ...usual, from: 'remembered' };
  return { quantity: 1, unit: 'packet', from: 'guess' };
}

/** Put a slip's grocery lines on the review sheet (once per slip line). */
export function queueSlipLines(
  receiptId: string,
  store: string | null,
  boughtAt: string,
  lines: { raw_name: string; quantity: number; amount: number; item_id: string }[]
): number {
  const exists = db.prepare('SELECT 1 FROM slip_lines WHERE receipt_id = ? AND raw_name = ?');
  const insert = db.prepare(
    `INSERT INTO slip_lines (id, receipt_id, store, bought_at, raw_name, quantity, amount, item_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  );
  let n = 0;
  for (const l of lines) {
    if (exists.get(receiptId, l.raw_name)) continue;
    insert.run(uuid(), receiptId, store, boughtAt, l.raw_name, l.quantity > 0 ? l.quantity : 1, l.amount, l.item_id, new Date().toISOString());
    n++;
  }
  return n;
}

export function pendingCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM slip_lines WHERE status = 'pending'").get() as { n: number }).n;
}

/** The review sheet: pending lines grouped by slip, each with its item and a pack guess. */
export function pendingSlips() {
  const rows = db
    .prepare("SELECT * FROM slip_lines WHERE status = 'pending' ORDER BY bought_at DESC, receipt_id, created_at, rowid")
    .all() as SlipLineRow[];
  const slips = new Map<string, { receipt_id: string; store: string | null; bought_at: string; lines: unknown[] }>();
  for (const r of rows) {
    const item = r.item_id ? getItem(r.item_id) : undefined;
    const slip = slips.get(r.receipt_id) ?? { receipt_id: r.receipt_id, store: r.store, bought_at: r.bought_at, lines: [] };
    slip.lines.push({
      id: r.id,
      raw_name: r.raw_name,
      quantity: r.quantity,
      amount: r.amount,
      item: item ? { id: item.id, name: item.name, in_pantry: Boolean(item.in_pantry) } : null,
      pack: guessPack(r.raw_name, r.item_id, r.quantity),
    });
    slips.set(r.receipt_id, slip);
  }
  return [...slips.values()];
}

/** An item made only for this slip line (a tidied slip name, nothing else linked or bought). */
function madeForSlip(item: ItemRow, raw: string): boolean {
  const others = db
    .prepare("SELECT COUNT(*) AS n FROM item_aliases WHERE item_id = ? AND NOT (kind = 'slip' AND value = ?)")
    .get(item.id, slipKey(raw)) as { n: number };
  const prices = db.prepare('SELECT COUNT(*) AS n FROM item_prices WHERE item_id = ? AND pack_label != ?').get(item.id, raw) as { n: number };
  const lists = db.prepare('SELECT COUNT(*) AS n FROM shopping_items WHERE item_id = ?').get(item.id) as { n: number };
  return !item.in_pantry && others.n === 0 && prices.n === 0 && lists.n === 0;
}

/**
 * Point a slip spelling at a different item ("SWTCORN WHL 410G" → Sweetcorn),
 * with the prices it brought. A name that isn't an item yet renames the item
 * that was made just for this line, rather than leaving a stray behind.
 */
function relinkSlip(raw: string, fromId: string | null, target: { item_id?: string | null; name?: string | null }): ItemRow {
  const from = fromId ? getItem(fromId) : undefined;
  let to = target.item_id ? getItem(target.item_id) : target.name?.trim() ? findItem({ name: target.name }) : undefined;
  if (!to && target.name?.trim()) {
    if (from && madeForSlip(from, raw)) {
      const name = target.name.trim();
      db.prepare('UPDATE items SET name = ?, name_key = ?, updated_at = ? WHERE id = ?').run(name, nameKey(name), new Date().toISOString(), from.id);
      return getItem(from.id)!;
    }
    to = ensureItem(target.name.trim());
  }
  if (!to) throw new Error(`Pick an item for “${raw}”`);
  if (from && from.id === to.id) return to;
  const key = slipKey(raw);
  const old = db.prepare("SELECT pack_quantity, pack_unit FROM item_aliases WHERE kind = 'slip' AND value = ?").get(key) as
    | { pack_quantity: number | null; pack_unit: string | null }
    | undefined;
  db.prepare(
    "INSERT OR REPLACE INTO item_aliases (kind, value, item_id, label, created_at, pack_quantity, pack_unit) VALUES ('slip', ?, ?, ?, ?, ?, ?)"
  ).run(key, to.id, raw.trim(), new Date().toISOString(), old?.pack_quantity ?? null, old?.pack_unit ?? null);
  if (from) {
    db.prepare('UPDATE item_prices SET item_id = ? WHERE item_id = ? AND pack_label = ?').run(to.id, from.id, raw);
    db.prepare('UPDATE slip_lines SET item_id = ? WHERE item_id = ? AND raw_name = ?').run(to.id, from.id, raw);
    refreshLatestPrice(from.id);
    const leftover = db
      .prepare(
        `SELECT 1 FROM items i WHERE i.id = ? AND i.in_pantry = 0
           AND NOT EXISTS (SELECT 1 FROM item_aliases a WHERE a.item_id = i.id)
           AND NOT EXISTS (SELECT 1 FROM item_prices p WHERE p.item_id = i.id)
           AND NOT EXISTS (SELECT 1 FROM shopping_items s WHERE s.item_id = i.id)`
      )
      .get(from.id);
    if (leftover) deleteItem(from.id);
  }
  refreshLatestPrice(to.id);
  return getItem(to.id)!;
}

/** Remember what one pack of this spelling is, and re-work the unit prices it brought. */
function rememberPack(raw: string, itemId: string, quantity: number | null, unit: string | null) {
  db.prepare("UPDATE item_aliases SET pack_quantity = ?, pack_unit = ? WHERE kind = 'slip' AND value = ?").run(quantity, unit, slipKey(raw));
  const rows = db.prepare('SELECT id, pack_price FROM item_prices WHERE item_id = ? AND pack_label = ?').all(itemId, raw) as {
    id: string;
    pack_price: number;
  }[];
  for (const r of rows) {
    const p = unitPriceFor(r.pack_price, raw, itemId);
    db.prepare('UPDATE item_prices SET unit_price = ?, price_unit = ? WHERE id = ?').run(p.unitPrice, p.priceUnit, r.id);
  }
  refreshLatestPrice(itemId);
}

/** A loose line's price once its weight (or count) is known: R50.38 for 2 kg of bananas is R25.19/kg. */
function priceLoose(line: SlipLineRow, itemId: string, quantity: number, unit: string | null) {
  const c = contentsFrom(quantity, unit) ?? (unit === null || unit === 'piece' ? { amount: quantity, unit: 'item' as const } : null);
  if (!c || !(line.amount > 0)) return;
  const row = db.prepare('SELECT id FROM item_prices WHERE item_id = ? AND receipt_id = ? AND pack_label = ?').get(itemId, line.receipt_id, line.raw_name) as
    | { id: string }
    | undefined;
  if (row) {
    db.prepare('UPDATE item_prices SET pack_price = ?, unit_price = ?, price_unit = ? WHERE id = ?').run(line.amount, line.amount / c.amount, c.unit, row.id);
  } else {
    db.prepare(
      `INSERT INTO item_prices (id, item_id, store, pack_price, pack_label, unit_price, price_unit, source, seen_at, receipt_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'slip', ?, ?)`
    ).run(uuid(), itemId, line.store, line.amount, line.raw_name, line.amount / c.amount, c.unit, line.bought_at, line.receipt_id);
  }
  refreshLatestPrice(itemId);
}

function tickOffShopping(item: ItemRow, raw: string): number {
  const open = db.prepare('SELECT id, item_id, name_key FROM shopping_items WHERE checked = 0').all() as {
    id: string;
    item_id: string | null;
    name_key: string;
  }[];
  const words = `${slipKey(raw)} ${item.name_key}`;
  const ts = new Date().toISOString();
  let n = 0;
  for (const line of open) {
    if (line.item_id === item.id || (line.name_key.length >= 3 && wordsWithin(line.name_key, words))) {
      db.prepare('UPDATE shopping_items SET checked = 1, checked_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, line.id);
      n++;
    }
  }
  return n;
}

export interface AcceptInput {
  id: string;
  /** An existing item, or a name (renames the item made for this line, or makes a new one). */
  item_id?: string | null;
  item_name?: string | null;
  /** What one pack is; null quantity = just "at home", no amount. */
  pack_quantity?: number | null;
  pack_unit?: string | null;
}

/** Check lines off the review sheet: into the pantry, answers remembered. */
export const acceptSlipLines = db.transaction((inputs: AcceptInput[]) => {
  const results: { raw_name: string; item: string; amount: string | null; ticked: number }[] = [];
  for (const input of inputs) {
    const line = db.prepare("SELECT * FROM slip_lines WHERE id = ? AND status = 'pending'").get(input.id) as SlipLineRow | undefined;
    if (!line) continue;
    const item =
      input.item_id || input.item_name ? relinkSlip(line.raw_name, line.item_id, { item_id: input.item_id, name: input.item_name }) : line.item_id ? getItem(line.item_id) : undefined;
    if (!item) throw new Error(`Pick an item for “${line.raw_name}”`);
    const guess = guessPack(line.raw_name, item.id, line.quantity);
    const packQty = input.pack_quantity !== undefined ? input.pack_quantity : guess.quantity;
    const packUnit = input.pack_unit !== undefined ? input.pack_unit || null : guess.unit;
    if (packQty !== null && !(packQty > 0)) throw new Error(`The pack size for “${line.raw_name}” must be more than 0`);
    // Loose produce: the answer is what this bag weighed (or how many were in it), which prices it.
    const loose = guess.from === 'loose';
    if (packQty !== null && !loose) rememberPack(line.raw_name, item.id, packQty, packUnit);
    if (packQty !== null && loose) priceLoose(line, item.id, packQty, packUnit);
    const total = packQty !== null ? Math.round((loose ? 1 : line.quantity) * packQty * 1000) / 1000 : null;
    const updated = addToPantry({ itemId: item.id, source: 'budgetpro', bought_at: line.bought_at, quantity: total, unit: total !== null ? packUnit : null, pack_label: line.raw_name });
    db.prepare("UPDATE slip_lines SET status = 'added', item_id = ?, done_at = ? WHERE id = ?").run(item.id, new Date().toISOString(), line.id);
    results.push({
      raw_name: line.raw_name,
      item: updated.name,
      amount: updated.pantry_quantity !== null ? `${updated.pantry_quantity}${updated.pantry_unit ? ` ${updated.pantry_unit}` : ''}` : null,
      ticked: tickOffShopping(updated, line.raw_name),
    });
  }
  return results;
});

/** Not groceries, or not wanted in the pantry: off the sheet without touching anything. */
export function skipSlipLines(ids: string[]): number {
  const stmt = db.prepare("UPDATE slip_lines SET status = 'skipped', done_at = ? WHERE id = ? AND status = 'pending'");
  return ids.reduce((n, id) => n + stmt.run(new Date().toISOString(), id).changes, 0);
}
