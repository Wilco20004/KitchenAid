import { Router } from 'express';
import { db } from '../db';
import { nameKey, parseIngredient } from '../ingredients';
import {
  addAlias,
  addToPantry,
  AliasKind,
  ensureItem,
  findItem,
  daysLeft,
  expiringItems,
  getItem,
  isDate,
  itemDetail,
  latestPricesByStore,
  listItems,
  mergeItems,
  removeAlias,
  removeFromPantry,
  setExpiry,
  setPackPrice,
} from '../items';
import { budgetProStatus, syncBudgetPro } from '../budgetpro';
import { parseAmount, useFromPantry } from '../cooking';
import { setSetting } from '../settings';

// The item catalogue, the pantry (items flagged in_pantry), barcodes and the
// BudgetPro link. Mounted at /api.

export const itemsRouter = Router();
const KINDS: AliasKind[] = ['barcode', 'name', 'slip', 'store'];

function fail(res: any, e: any, status = 400) {
  res.status(status).json({ error: e.message });
}

// GET /api/items?q=soup&pantry=1
itemsRouter.get('/items', (req, res) => {
  res.json(listItems({ q: typeof req.query.q === 'string' ? req.query.q : undefined, pantryOnly: req.query.pantry === '1' }));
});

itemsRouter.get('/items/:id', (req, res) => {
  const item = itemDetail(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json({ ...item, paid: latestPricesByStore(item.id) });
});

itemsRouter.post('/items', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const item = ensureItem(name, req.body.category_id ?? undefined);
  if (req.body.barcode) {
    try {
      addAlias(item.id, 'barcode', String(req.body.barcode), req.body.barcode_label ?? null);
    } catch (e) {
      return fail(res, e, 409);
    }
  }
  res.status(201).json(itemDetail(item.id));
});

itemsRouter.put('/items/:id', (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : item.name;
  const key = nameKey(name);
  const clash = db.prepare('SELECT name FROM items WHERE name_key = ? AND id != ?').get(key, item.id) as { name: string } | undefined;
  if (clash) return res.status(409).json({ error: `“${clash.name}” already exists — merge them instead` });
  db.prepare('UPDATE items SET name = ?, name_key = ?, category_id = ?, updated_at = ? WHERE id = ?').run(
    name,
    key,
    req.body?.category_id !== undefined ? req.body.category_id || null : item.category_id,
    new Date().toISOString(),
    item.id
  );
  // Renaming keeps the old name recognisable.
  if (key !== item.name_key) {
    db.prepare("INSERT OR IGNORE INTO item_aliases (kind, value, item_id, label, created_at) VALUES ('name', ?, ?, ?, ?)").run(
      item.name_key,
      item.id,
      item.name,
      new Date().toISOString()
    );
  }
  db.prepare('UPDATE shopping_items SET name_key = ? WHERE item_id = ?').run(key, item.id);
  res.json(itemDetail(item.id));
});

itemsRouter.delete('/items/:id', (req, res) => {
  const r = db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Item not found' });
  res.status(204).end();
});

// ---------- pantry ----------

// POST /api/pantry { text: "2 kg rice" } — quick add, creating the item if new
itemsRouter.post('/pantry', (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'Type what you have' });
  const p = parseIngredient(text);
  const expires = req.body?.expires_at ?? null;
  if (expires !== null && !isDate(expires)) return res.status(400).json({ error: 'Use-by date must be YYYY-MM-DD' });
  res.status(201).json(addToPantry({ name: p.name, quantity: p.quantity, unit: p.unit, note: p.note, expires_at: expires }));
});

// GET /api/pantry/expiring?days=7 — at home and past, or near, its use-by
// date, soonest first. Handy for a Home Assistant REST sensor.
itemsRouter.get('/pantry/expiring', (req, res) => {
  const days = Math.min(365, Math.max(0, Number(req.query.days ?? 7) || 0));
  const items = expiringItems(days).map((i) => ({ id: i.id, name: i.name, use_by: i.expires_at, days_left: daysLeft(i.expires_at!) }));
  res.json({ days, count: items.length, expired: items.filter((i) => i.days_left < 0).length, items });
});

itemsRouter.post('/items/:id/pantry', (req, res) => {
  const expires = req.body?.expires_at ?? null;
  if (expires !== null && !isDate(expires)) return res.status(400).json({ error: 'Use-by date must be YYYY-MM-DD' });
  try {
    res.json(
      addToPantry({ itemId: req.params.id, quantity: req.body?.quantity ?? null, unit: req.body?.unit ?? null, note: req.body?.note ?? null, expires_at: expires })
    );
  } catch (e) {
    fail(res, e, 404);
  }
});

// POST /api/items/:id/use { amount: "2" | "250 g" } or { used_up: true } — used some
itemsRouter.post('/items/:id/use', (req, res) => {
  const amount = typeof req.body?.amount === 'string' && req.body.amount.trim() ? parseAmount(req.body.amount) : null;
  if (!amount && !req.body?.used_up) return res.status(400).json({ error: 'Say how much was used, e.g. 2 or 250 g' });
  try {
    const result = useFromPantry(req.params.id, { amount, usedUp: Boolean(req.body?.used_up) });
    res.json({ result, item: itemDetail(req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

// Used it up
itemsRouter.delete('/items/:id/pantry', (req, res) => {
  removeFromPantry(req.params.id);
  res.json(itemDetail(req.params.id));
});

// PUT /api/items/:id/expiry { expires_at: "2026-10-03" | null, keeps_days: 90 | null } — either or both
itemsRouter.put('/items/:id/expiry', (req, res) => {
  const body = req.body ?? {};
  const input: { expires_at?: string | null; keeps_days?: number | null } = {};
  if ('expires_at' in body) input.expires_at = body.expires_at || null;
  if ('keeps_days' in body) input.keeps_days = body.keeps_days === null || body.keeps_days === '' ? null : Number(body.keeps_days);
  try {
    setExpiry(req.params.id, input);
    res.json(itemDetail(req.params.id));
  } catch (e: any) {
    fail(res, e, e.message === 'Item not found' ? 404 : 400);
  }
});

// PUT /api/items/:id/price { pack_price: 72, pack_label: "18 eggs" } — set by hand
itemsRouter.put('/items/:id/price', (req, res) => {
  if (!getItem(req.params.id)) return res.status(404).json({ error: 'Item not found' });
  const price = Number(req.body?.pack_price);
  if (!(price > 0)) return res.status(400).json({ error: 'pack_price must be more than 0' });
  setPackPrice(req.params.id, price, String(req.body?.pack_label ?? '').trim() || '1', 'manual');
  res.json(itemDetail(req.params.id));
});

// ---------- aliases & merging ----------

itemsRouter.post('/items/:id/aliases', (req, res) => {
  const kind = req.body?.kind as AliasKind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` });
  if (!getItem(req.params.id)) return res.status(404).json({ error: 'Item not found' });
  try {
    addAlias(req.params.id, kind, String(req.body?.value ?? ''), req.body?.label ?? null);
    res.status(201).json(itemDetail(req.params.id));
  } catch (e) {
    fail(res, e, 409);
  }
});

// DELETE /api/items/:id/aliases?kind=barcode&value=6001087...
itemsRouter.delete('/items/:id/aliases', (req, res) => {
  removeAlias(String(req.query.kind) as AliasKind, String(req.query.value ?? ''));
  res.json(itemDetail(req.params.id));
});

// POST /api/items/:id/merge { into } — fold this item into another
itemsRouter.post('/items/:id/merge', (req, res) => {
  try {
    res.json(itemDetail(mergeItems(req.params.id, String(req.body?.into ?? '')).id));
  } catch (e) {
    fail(res, e);
  }
});

// ---------- barcodes ----------

/** Open Food Facts knows most packaged groceries by barcode — only asked when a code isn't linked yet. */
async function lookupBarcode(code: string) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,quantity,image_front_small_url`,
      { headers: { 'User-Agent': 'KitchenAid/0.2 (Home Assistant add-on; home use)' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const body: any = await res.json();
    if (body.status !== 1 || !body.product) return null;
    const p = body.product;
    const brand = String(p.brands ?? '').split(',')[0].trim() || null;
    return { name: String(p.product_name ?? '').trim() || null, brand, quantity: p.quantity || null, image: p.image_front_small_url || null };
  } catch {
    return null;
  }
}

// GET /api/barcode/6001087340281 — the item it's linked to, or a suggestion for a new one
itemsRouter.get('/barcode/:code', async (req, res) => {
  const code = req.params.code.replace(/\s+/g, '');
  if (!/^\d{6,14}$/.test(code)) return res.status(400).json({ error: "That doesn't look like a barcode" });
  const item = findItem({ barcode: code });
  if (item) return res.json({ code, item: itemDetail(item.id) });
  const lookup = await lookupBarcode(code);
  // Suggest existing items the product name points at ("Knorr Brown Onion Soup" → "Brown onion soup").
  let suggestions: unknown[] = [];
  if (lookup?.name) {
    const words = nameKey(lookup.name.replace(lookup.brand ?? '', '')).split(' ').filter((w) => w.length >= 3);
    suggestions = listItems()
      .map((i) => ({ i, hits: words.filter((w) => i.name_key.split(' ').includes(w)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 5)
      .map((x) => ({ id: x.i.id, name: x.i.name }));
  }
  res.json({ code, item: null, lookup, suggestions });
});

// ---------- BudgetPro ----------

itemsRouter.get('/budgetpro', (_req, res) => {
  res.json(budgetProStatus());
});

itemsRouter.post('/budgetpro/sync', async (_req, res) => {
  try {
    res.json(await syncBudgetPro());
  } catch (e: any) {
    setSetting('budgetpro_last_error', e.message);
    fail(res, e, 502);
  }
});
