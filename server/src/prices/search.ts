import { options } from './config';
import { db } from '../db';

const now = () => new Date().toISOString();
import { activeStores, storeById } from './stores';
import { ScrapedProduct, StoreAdapter } from './stores/types';
import { parsePackSize, unitPrices } from './units';

// A store that just failed isn't asked again for a while, however many
// searches come in; the last good result is served instead. A store that
// refused us (403/429, human check) is left alone much longer than one that
// merely timed out.
const ERROR_BACKOFF_MS = 60 * 60 * 1000;
const REFUSED_BACKOFF_MS = 6 * 60 * 60 * 1000;

function isRefusal(error: string | null): boolean {
  return !!error && /human check|HTTP 403|HTTP 429/.test(error);
}

function backoffFor(error: string | null): number {
  return isRefusal(error) ? REFUSED_BACKOFF_MS : ERROR_BACKOFF_MS;
}

// A refusal pauses the whole store, not just the term that got it — even
// "Refresh now" waits it out.
const storePausedUntil = new Map<string, number>();

export function storePause(store: string): string | null {
  const until = storePausedUntil.get(store);
  return until && until > Date.now() ? new Date(until).toISOString() : null;
}

export function termKey(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface SearchRow {
  store: string;
  term_key: string;
  term: string;
  fetched_at: string | null;
  error: string | null;
  error_at: string | null;
}

function ageMs(iso: string | null): number {
  return iso ? Date.now() - new Date(iso).getTime() : Infinity;
}

function needsRefresh(row: SearchRow | undefined, force: boolean, cacheHours: number): boolean {
  if (row && ageMs(row.error_at) < backoffFor(row.error) && ageMs(row.error_at) < ageMs(row.fetched_at) && !force) {
    return false;
  }
  if (force) return true;
  return ageMs(row?.fetched_at ?? null) >= cacheHours * 3600 * 1000;
}

const upsertProduct = db.prepare(`
  INSERT INTO price_products (id, store, store_product_id, name, brand, size_text, price, priced_per_kg,
                        was_price, promo, url, image_url, in_stock, first_seen, updated_at)
  VALUES (@id, @store, @storeProductId, @name, @brand, @sizeText, @price, @pricedPerKg,
          @wasPrice, @promo, @url, @imageUrl, @inStock, @now, @now)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, brand = excluded.brand, size_text = excluded.size_text,
    price = excluded.price, priced_per_kg = excluded.priced_per_kg, was_price = excluded.was_price,
    promo = excluded.promo, url = excluded.url, image_url = excluded.image_url,
    in_stock = excluded.in_stock, updated_at = excluded.updated_at
`);
const lastPrice = db.prepare(
  'SELECT price FROM price_history WHERE product_id = ? ORDER BY seen_at DESC, rowid DESC LIMIT 1'
);
const addHistory = db.prepare('INSERT INTO price_history (product_id, price, seen_at) VALUES (?, ?, ?)');

const saveResults = db.transaction((store: string, key: string, term: string, products: ScrapedProduct[]) => {
  const ts = now();
  db.prepare('DELETE FROM price_search_results WHERE store = ? AND term_key = ?').run(store, key);
  const link = db.prepare(
    'INSERT OR IGNORE INTO price_search_results (store, term_key, product_id, rank) VALUES (?, ?, ?, ?)'
  );
  products.forEach((p, rank) => {
    const id = `${store}:${p.storeProductId}`;
    upsertProduct.run({
      id,
      store,
      storeProductId: p.storeProductId,
      name: p.name,
      brand: p.brand ?? null,
      sizeText: p.sizeText ?? null,
      price: p.price,
      pricedPerKg: p.pricedPerKg ? 1 : 0,
      wasPrice: p.wasPrice ?? null,
      promo: p.promo ?? null,
      url: p.url ?? null,
      imageUrl: p.imageUrl ?? null,
      inStock: p.inStock == null ? null : p.inStock ? 1 : 0,
      now: ts,
    });
    const prev = lastPrice.get(id) as { price: number } | undefined;
    if (!prev || prev.price !== p.price) addHistory.run(id, p.price, ts);
    link.run(store, key, id, rank);
  });
  db.prepare(
    `INSERT INTO price_searches (store, term_key, term, fetched_at, error, error_at) VALUES (?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(store, term_key) DO UPDATE SET term = excluded.term, fetched_at = excluded.fetched_at,
       error = NULL, error_at = NULL`
  ).run(store, key, term, ts);
});

function saveError(store: string, key: string, term: string, message: string) {
  db.prepare(
    `INSERT INTO price_searches (store, term_key, term, error, error_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(store, term_key) DO UPDATE SET error = excluded.error, error_at = excluded.error_at`
  ).run(store, key, term, message, now());
}

// Two searches for the same term at once share one request per store.
const inFlight = new Map<string, Promise<void>>();

function refresh(store: StoreAdapter, term: string): Promise<void> {
  const key = termKey(term);
  const flightKey = `${store.id}|${key}`;
  const existing = inFlight.get(flightKey);
  if (existing) return existing;
  const job = store
    .search(term)
    .then((products) => saveResults(store.id, key, term.trim(), products))
    .catch((err) => {
      console.warn(`[search] ${store.id} "${term}": ${err.message}`);
      saveError(store.id, key, term.trim(), err.message);
      if (isRefusal(err.message)) storePausedUntil.set(store.id, Date.now() + REFUSED_BACKOFF_MS);
    })
    .finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, job);
  return job;
}

export interface StoreStatus {
  store: string;
  name: string;
  fetchedAt: string | null;
  refreshed: boolean;
  error: string | null;
  count: number;
  pausedUntil: string | null;
}

export interface ProductResult {
  id: string;
  store: string;
  storeName: string;
  name: string;
  brand: string | null;
  sizeText: string | null;
  sizeOverride: string | null;
  price: number;
  wasPrice: number | null;
  promo: string | null;
  url: string | null;
  imageUrl: string | null;
  inStock: boolean | null;
  rank: number;
  packCount: number;
  perItem: number | null;
  perMeasure: number | null;
  measureLabel: string | null;
  updatedAt: string;
}

export function toResult(row: any): ProductResult {
  const sizeSource = row.size_override ?? [row.size_text, row.name].filter(Boolean).join(' ');
  const size = parsePackSize(row.priced_per_kg ? 'per kg' : sizeSource);
  const unit = unitPrices(row.price, size);
  return {
    id: row.id,
    store: row.store,
    storeName: storeById(row.store)?.name ?? row.store,
    name: row.name,
    brand: row.brand,
    sizeText: row.size_text,
    sizeOverride: row.size_override,
    price: row.price,
    wasPrice: row.was_price,
    promo: row.promo,
    url: row.url,
    imageUrl: row.image_url,
    inStock: row.in_stock == null ? null : !!row.in_stock,
    rank: row.rank ?? 0,
    packCount: size.count,
    ...unit,
    updatedAt: row.updated_at,
  };
}

const stemWord = (w: string) =>
  w.length > 3 && w.endsWith('ies') ? w.slice(0, -3) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;

/**
 * A catalog store's answer: every product it has shown us in the last
 * keepDays whose name holds all the search words — "eggs" finds eggs from
 * whichever broad searches brought them in. Costs nothing.
 */
export function catalogMatches(store: StoreAdapter, term: string): ProductResult[] {
  const words = termKey(term)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2)
    .map(stemWord);
  if (!words.length) return [];
  const since = new Date(Date.now() - (store.keepDays?.() ?? 14) * 86400000).toISOString();
  const rows = db.prepare('SELECT * FROM price_products WHERE store = ? AND updated_at >= ?').all(store.id, since) as any[];
  return (
    rows
      .filter((r) => {
        const hay = `${r.brand ?? ''} ${r.name}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      // Shorter names first: "Large Eggs 18" before "Egg Noodles With Chicken Flavour".
      .sort((a, b) => a.name.length - b.name.length)
      .map((r, rank) => toResult({ ...r, rank }))
  );
}

/** Fetch one term from one store now (the Checkers daily job uses this); returns the error, if any. */
export async function fetchTerm(store: StoreAdapter, term: string): Promise<string | null> {
  await refresh(store, term);
  const row = db
    .prepare('SELECT * FROM price_searches WHERE store = ? AND term_key = ?')
    .get(store.id, termKey(term)) as SearchRow | undefined;
  return row?.error && ageMs(row.error_at) < ageMs(row.fetched_at) ? row.error : null;
}

/** cacheOnly: answer from what's stored, never ask a store (used by recipe costing). */
export async function search(term: string, opts: { force?: boolean; stores?: string[]; cacheOnly?: boolean } = {}) {
  const key = termKey(term);
  const stores = activeStores().filter((s) => !opts.stores?.length || opts.stores.includes(s.id));
  const getRow = db.prepare('SELECT * FROM price_searches WHERE store = ? AND term_key = ?');

  const refreshed = new Set<string>();
  await Promise.all(
    stores.map(async (s) => {
      if (s.mode === 'catalog') return; // never fetched on demand — see catalogMatches
      if (!opts.cacheOnly && !storePause(s.id) && needsRefresh(getRow.get(s.id, key) as SearchRow | undefined, !!opts.force, options.cache_hours)) {
        await refresh(s, term);
        refreshed.add(s.id);
      }
    })
  );

  const rows = db
    .prepare(
      `SELECT p.*, r.rank FROM price_search_results r JOIN price_products p ON p.id = r.product_id
       WHERE r.term_key = ? ORDER BY r.store, r.rank`
    )
    .all(key) as any[];
  const products = [
    ...rows.filter((r) => stores.some((s) => s.id === r.store && s.mode !== 'catalog')).map(toResult),
    ...stores.filter((s) => s.mode === 'catalog').flatMap((s) => catalogMatches(s, term)),
  ];

  const status: StoreStatus[] = stores.map((s) => {
    if (s.mode === 'catalog') {
      const newest = db.prepare('SELECT MAX(updated_at) AS t FROM price_products WHERE store = ?').get(s.id) as { t: string | null };
      return {
        store: s.id,
        name: s.name,
        fetchedAt: newest.t,
        refreshed: false,
        error: null,
        count: products.filter((p) => p.store === s.id).length,
        pausedUntil: null,
      };
    }
    const row = getRow.get(s.id, key) as SearchRow | undefined;
    const failedLast = !!row?.error && ageMs(row.error_at) < ageMs(row.fetched_at);
    return {
      store: s.id,
      name: s.name,
      fetchedAt: row?.fetched_at ?? null,
      refreshed: refreshed.has(s.id) && !failedLast,
      error: failedLast ? row!.error : null,
      count: products.filter((p) => p.store === s.id).length,
      pausedUntil: storePause(s.id),
    };
  });

  return { term: term.trim(), termKey: key, stores: status, products };
}

export function recentTerms(limit = 20) {
  return db
    .prepare(
      `SELECT term_key AS termKey, MAX(term) AS term, MAX(fetched_at) AS fetchedAt
       FROM price_searches WHERE fetched_at IS NOT NULL GROUP BY term_key ORDER BY MAX(fetched_at) DESC LIMIT ?`
    )
    .all(limit);
}

// Watched terms are re-fetched once they go stale, even if nobody searches.
export function startWatchlistRefresher() {
  const tick = async () => {
    const terms = db.prepare('SELECT term FROM price_watchlist ORDER BY created_at').all() as { term: string }[];
    for (const { term } of terms) {
      try {
        // Stores that cost credits (Checkers via Parse) only refresh when you search.
        await search(term, { stores: activeStores().filter((s) => s.background !== false).map((s) => s.id) });
      } catch (err: any) {
        console.warn(`[watchlist] "${term}": ${err.message}`);
      }
    }
  };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 60 * 60 * 1000);
}
