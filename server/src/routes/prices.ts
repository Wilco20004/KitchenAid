import { Router } from 'express';
import { db } from '../db';
import { recentTerms, search, termKey, toResult } from '../prices/search';
import { activeStores } from '../prices/stores';
import { matchItem } from '../prices/basket';
import { paidPricesFor } from '../paid';
import { options } from '../prices/config';
import { checkersCreditsToday, checkersCreditsUsed } from '../prices/stores/checkers';
import { candidateTerms, lastCheckersRun, runCheckersDaily } from '../prices/checkersDaily';

// Price comparison across Pick n Pay, Makro and Woolworths (what used to be
// the separate PriceScout add-on).

export const pricesRouter = Router();
const now = () => new Date().toISOString();

// GET /api/prices/search?q=tomato can&force=1&stores=pnp,makro
pricesRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Search for at least 2 characters' });
  if (q.length > 80) return res.status(400).json({ error: 'Search term too long' });
  const stores = req.query.stores ? String(req.query.stores).split(',').filter(Boolean) : undefined;
  try {
    res.json(await search(q, { force: req.query.force === '1', stores }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

pricesRouter.get('/recent', (_req, res) => {
  res.json(recentTerms());
});

pricesRouter.get('/checkers', (_req, res) => {
  res.json({
    configured: Boolean(options.parse_api_key),
    credits_month: checkersCreditsUsed(),
    credit_cap_month: options.checkers_monthly_credits,
    credits_today: checkersCreditsToday(),
    per_day: options.checkers_daily_searches,
    catalogue_products: (
      db.prepare("SELECT COUNT(*) AS n FROM price_products WHERE store = 'checkers' AND updated_at >= ?").get(
        new Date(Date.now() - options.checkers_keep_days * 86400000).toISOString()
      ) as { n: number }
    ).n,
    last_run: lastCheckersRun(),
    next_terms: options.parse_api_key ? candidateTerms().slice(0, 12) : [],
  });
});

// POST /api/prices/checkers/run — spend what's left of today's budget now
pricesRouter.post('/checkers/run', async (_req, res) => {
  try {
    res.json(await runCheckersDaily());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

pricesRouter.get('/stores', (_req, res) => {
  res.json(activeStores().map((s) => ({ id: s.id, name: s.name })));
});

// POST /api/prices/match { name, quantity, unit } — one shopping-list item's
// best buy per store. The UI calls this item by item to show progress.
pricesRouter.post('/match', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'name is required' });
  try {
    res.json(await matchItem({ name, quantity: req.body.quantity ?? null, unit: req.body.unit ?? null }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prices/paid { items: [{ item_id?, name, quantity, unit }] } — from your own slips, per shop
pricesRouter.post('/paid', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.filter((i: any) => typeof i?.name === 'string') : [];
  res.json(paidPricesFor(items));
});

pricesRouter.get('/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM price_products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found' });
  const history = db
    .prepare('SELECT price, seen_at AS seenAt FROM price_history WHERE product_id = ? ORDER BY seen_at')
    .all(req.params.id);
  res.json({ ...toResult(row), history });
});

// PATCH /api/prices/products/:id { sizeOverride: "9 rolls" | null }
pricesRouter.patch('/products/:id', (req, res) => {
  const raw = req.body?.sizeOverride;
  const value = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 60) : null;
  const info = db.prepare('UPDATE price_products SET size_override = ?, updated_at = ? WHERE id = ?').run(value, now(), req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Product not found' });
  res.json(toResult(db.prepare('SELECT * FROM price_products WHERE id = ?').get(req.params.id)));
});

const BASES = ['measure', 'item', 'pack'];

export function listWatchlist() {
  return db
    .prepare(
      `SELECT term_key AS termKey, term, include_words AS includeWords, exclude_words AS excludeWords, basis, created_at AS createdAt
       FROM price_watchlist ORDER BY term COLLATE NOCASE`
    )
    .all();
}

export function watchTerm(input: { term: string; includeWords?: string; excludeWords?: string; basis?: string }) {
  const term = String(input.term ?? '').trim();
  if (term.length < 2 || term.length > 80) throw new Error('Term must be 2–80 characters');
  const includeWords = String(input.includeWords ?? '').trim().slice(0, 120);
  const excludeWords = String(input.excludeWords ?? '').trim().slice(0, 120);
  const basis = BASES.includes(input.basis ?? '') ? input.basis! : 'measure';
  db.prepare(
    `INSERT INTO price_watchlist (term_key, term, include_words, exclude_words, basis, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(term_key) DO UPDATE SET include_words = excluded.include_words, exclude_words = excluded.exclude_words, basis = excluded.basis`
  ).run(termKey(term), term, includeWords, excludeWords, basis, now());
  return { termKey: termKey(term), term, includeWords, excludeWords, basis };
}

pricesRouter.get('/watchlist', (_req, res) => {
  res.json(listWatchlist());
});

pricesRouter.post('/watchlist', (req, res) => {
  try {
    res.status(201).json(watchTerm(req.body ?? {}));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

pricesRouter.delete('/watchlist/:termKey', (req, res) => {
  db.prepare('DELETE FROM price_watchlist WHERE term_key = ?').run(req.params.termKey);
  res.status(204).end();
});
