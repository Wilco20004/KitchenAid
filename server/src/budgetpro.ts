import { db } from './db';
import { addToPantry, itemForSlipLine, setPackPrice, slipKey, storeName, wordsWithin } from './items';
import { getBudgetProOptions, getSetting, setSetting } from './settings';

// Pulls grocery slips from the BudgetPro add-on (its REST API, with the API
// token from BudgetPro → Settings → API & AI access). Every grocery line on a
// new slip goes into the pantry, and anything on the shopping list that the
// slip shows you bought gets ticked off. BudgetPro itself isn't changed.

const SYNC_EVERY_MS = 30 * 60 * 1000;
// First sync only looks back this far, so connecting doesn't pour months of
// old slips into the pantry.
const FIRST_SYNC_DAYS = 7;
// Prices (not pantry) are learnt from slips this far back.
const HISTORY_DAYS = 180;
// No single grocery pack costs this much; a line that does was misread
// (the slip's total or a card number read as a price).
export const MAX_PACK_PRICE = 2000;

export interface SyncResult {
  receipts: number;
  items: number;
  ticked: number;
  skipped: number;
  history_receipts: number;
  lastSync: string;
}

export function budgetProConfigured(): boolean {
  const o = getBudgetProOptions();
  return Boolean(o.url && o.token);
}

async function bpGet<T>(path: string): Promise<T> {
  const { url, token } = getBudgetProOptions();
  let res: Response;
  try {
    res = await fetch(`${url}/api/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e: any) {
    throw new Error(`Couldn't reach BudgetPro at ${url}: ${e.cause?.code || e.message}`);
  }
  if (res.status === 401) throw new Error('BudgetPro rejected the token — copy it again from BudgetPro → Settings → API & AI access.');
  if (!res.ok) throw new Error(`BudgetPro answered HTTP ${res.status} for ${path}`);
  if (!(res.headers.get('content-type') || '').includes('json')) {
    throw new Error("That address isn't BudgetPro's API — use its own port, e.g. http://<your-HA-IP>:8097 (not the sidebar link).");
  }
  return res.json() as Promise<T>;
}

interface BpCategory {
  id: string;
  name: string;
  parent_id: string | null;
}

interface BpReceiptSummary {
  id: string;
  status: string;
  receipt_date: string | null;
  created_at: string;
  merchant_name: string | null;
  item_count: number;
}

interface BpReceiptItem {
  raw_name: string;
  quantity: number;
  amount: number;
  category_id: string | null;
  product_category_id: string | null;
}

let running: Promise<SyncResult> | null = null;

export function syncBudgetPro(): Promise<SyncResult> {
  // One sync at a time; a second request just waits for the first.
  running ??= doSync().finally(() => (running = null));
  return running;
}

async function doSync(): Promise<SyncResult> {
  if (!budgetProConfigured()) throw new Error('BudgetPro isn\'t connected — set budgetpro_url and budgetpro_token in the add-on Configuration tab.');
  const { categories: wanted } = getBudgetProOptions();

  // The grocery categories named in the options, plus their subcategories
  // (BudgetPro lets Groceries have children such as Meat).
  const categories = await bpGet<BpCategory[]>('categories');
  const ids = new Set(categories.filter((c) => wanted.includes(c.name.toLowerCase())).map((c) => c.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }

  const since =
    getSetting('budgetpro_since') ?? new Date(Date.now() - FIRST_SYNC_DAYS * 86400000).toISOString().slice(0, 10);
  if (!getSetting('budgetpro_since')) setSetting('budgetpro_since', since);

  // Older slips (up to HISTORY_DAYS) still teach prices — what things cost
  // at Checkers or SPAR — without pouring old shopping into the pantry.
  const historySince = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  const dateOf = (r: BpReceiptSummary) => r.receipt_date ?? r.created_at.slice(0, 10);
  // A slip dated in the future was misread (OCR turned "2025" into "2038"),
  // and so, almost always, were its lines — leave it until it's fixed in BudgetPro.
  const latest = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const receipts = (await bpGet<BpReceiptSummary[]>('receipts')).filter(
    (r) => r.status === 'parsed' && r.item_count > 0 && dateOf(r) >= historySince && dateOf(r) <= latest
  );
  const seen = (ext: string) => Boolean(db.prepare('SELECT 1 FROM imported WHERE external_id = ?').get(ext));
  const mark = (ext: string, id: string) => db.prepare('INSERT OR REPLACE INTO imported (external_id, local_id) VALUES (?, ?)').run(ext, id);

  const result: SyncResult = { receipts: 0, items: 0, ticked: 0, skipped: 0, history_receipts: 0, lastSync: new Date().toISOString() };
  for (const summary of receipts) {
    // full = recent and not yet in the pantry; prices are learnt once per slip either way.
    const recent = dateOf(summary) >= since;
    const full = recent && !seen(`budgetpro:receipt:${summary.id}`);
    const ext = `budgetpro:receipt:${summary.id}`;
    const priceExt = `budgetpro:prices:${summary.id}`;
    if (!full && seen(priceExt)) {
      result.skipped++;
      continue;
    }
    const receipt = await bpGet<{ items: BpReceiptItem[]; receipt_date: string | null; merchant_name: string | null }>(`receipts/${summary.id}`);
    const bought = receipt.items.filter(
      (i) => i.amount > 0 && i.amount / (i.quantity > 0 ? i.quantity : 1) <= MAX_PACK_PRICE && ids.has(i.category_id ?? i.product_category_id ?? '')
    );
    const boughtAt = receipt.receipt_date ?? summary.created_at.slice(0, 10);
    const store = storeName(receipt.merchant_name ?? summary.merchant_name);

    db.transaction(() => {
      for (const line of bought) {
        const item = itemForSlipLine(line.raw_name);
        // What one pack cost (a line can be "2 x"). The item's own "last
        // price" only moves forward in time — slips can arrive out of order.
        const qty = line.quantity > 0 ? line.quantity : 1;
        if (!seen(priceExt)) {
          setPackPrice(item.id, line.amount / qty, line.raw_name, 'slip', boughtAt, { store, receiptId: summary.id, historyOnly: true });
        }
        if (full) {
          addToPantry({ itemId: item.id, source: 'budgetpro', bought_at: boughtAt });
          result.items++;
          result.ticked += tickOffShopping(item.id, `${slipKey(line.raw_name)} ${item.name_key}`);
        }
      }
      mark(priceExt, summary.id);
      if (full) mark(ext, summary.id);
    })();
    if (full) result.receipts++;
    else result.history_receipts++;
  }
  setSetting('budgetpro_last_sync', result.lastSync);
  setSetting('budgetpro_last_result', JSON.stringify(result));
  setSetting('budgetpro_last_error', '');
  return result;
}

/** Tick open shopping-list lines for this item (or whose words all appear on the slip line). */
function tickOffShopping(itemId: string, slipWords: string): number {
  const open = db.prepare('SELECT id, item_id, name_key FROM shopping_items WHERE checked = 0').all() as {
    id: string;
    item_id: string | null;
    name_key: string;
  }[];
  let n = 0;
  const ts = new Date().toISOString();
  for (const line of open) {
    if (line.item_id === itemId || (line.name_key.length >= 3 && wordsWithin(line.name_key, slipWords))) {
      db.prepare('UPDATE shopping_items SET checked = 1, checked_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, line.id);
      n++;
    }
  }
  return n;
}

export function budgetProStatus() {
  const raw = getSetting('budgetpro_last_result');
  return {
    configured: budgetProConfigured(),
    url: getBudgetProOptions().url || null,
    categories: getBudgetProOptions().categories,
    lastSync: getSetting('budgetpro_last_sync'),
    lastResult: raw ? (JSON.parse(raw) as SyncResult) : null,
    lastError: getSetting('budgetpro_last_error') || null,
  };
}

export function startBudgetProSync() {
  const tick = () => {
    if (!budgetProConfigured()) return;
    syncBudgetPro().catch((e) => {
      console.warn(`[budgetpro] ${e.message}`);
      setSetting('budgetpro_last_error', e.message);
    });
  };
  setTimeout(tick, 30 * 1000);
  setInterval(tick, SYNC_EVERY_MS);
}
