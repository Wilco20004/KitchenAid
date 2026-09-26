import { options } from '../config';
import { getSetting, setSetting } from '../../settings';
import { setMinGap, storeFetch } from './http';
import { ScrapedProduct, StoreAdapter } from './types';

// Checkers blocks automated requests to its own site (even a plain headless
// browser gets HTTP 403), so it's reached through Parse (parse.bot): a paid,
// third-party, unofficial API over checkers.co.za that the user subscribes
// to. Every call costs a credit, so it is never called when you search:
// once a day a few broad terms ("milk", "rice") are fetched with a big page
// of results each (see checkersDaily.ts), and searches match those stored
// products locally. Daily and monthly caps stop it at the plan's budget.

// Overridable only so the adapter can be tested against a stand-in.
const endpoint = () =>
  process.env.PARSE_CHECKERS_URL || 'https://api.parse.bot/scraper/a7a3a4ba-dfb7-4476-9712-8753b2fb3140/search_products';
const PAGE_SIZE = 100;

const monthKey = () => `parse_credits:${new Date().toISOString().slice(0, 7)}`;
const dayKey = () => `parse_credits_day:${new Date().toISOString().slice(0, 10)}`;

export function checkersCreditsUsed(): number {
  return Number(getSetting(monthKey()) ?? 0);
}

export function checkersCreditsToday(): number {
  return Number(getSetting(dayKey()) ?? 0);
}

/** Searches still allowed right now under both caps. */
export function checkersBudgetLeft(): number {
  return Math.max(0, Math.min(options.checkers_daily_searches - checkersCreditsToday(), options.checkers_monthly_credits - checkersCreditsUsed()));
}

export class CreditBudgetError extends Error {}

/** Parse wraps results as { data: { products, totalCount } }; tolerate it unwrapped too. */
export function parseCheckers(body: any): ScrapedProduct[] {
  const data = body?.data ?? body;
  const list: any[] = data?.products ?? data?.results ?? [];
  const out: ScrapedProduct[] = [];
  for (const p of list) {
    const cents = Number(p.priceWithoutDecimal ?? NaN);
    const price = Number.isFinite(cents) ? cents / 100 : Number(p.price);
    const id = p.id ?? p.articleNumber ?? p.code;
    if (!id || !p.name || !(price > 0)) continue;
    const wasCents = Number(p.oldPriceWithoutDecimal ?? p.wasPriceWithoutDecimal ?? NaN);
    out.push({
      storeProductId: String(id),
      name: String(p.name).trim(),
      brand: p.brand ?? null,
      price,
      wasPrice: Number.isFinite(wasCents) && wasCents / 100 > price ? wasCents / 100 : null,
      promo: p.isOnPromotion ? (p.promotionText ?? p.promotion?.name ?? 'On promotion') : null,
      // Opening a product needs a slug we can't be sure of; a search link always works.
      url: `https://www.checkers.co.za/search/all?q=${encodeURIComponent(String(p.name))}`,
      imageUrl: typeof p.image === 'string' && /^https?:/.test(p.image) ? p.image : null,
      inStock: typeof p.isStockAvailable === 'boolean' ? p.isStockAvailable : null,
    });
  }
  return out;
}

export const checkers: StoreAdapter = {
  id: 'checkers',
  name: 'Checkers',
  enabled: () => Boolean(options.parse_api_key),
  mode: 'catalog',
  keepDays: () => options.checkers_keep_days,
  background: false,
  async search(term) {
    if (checkersBudgetLeft() <= 0) {
      throw new CreditBudgetError("Checkers: today's (or this month's) Parse credit budget is used up");
    }
    setMinGap('checkers', Math.ceil(60000 / Math.max(1, options.checkers_requests_per_minute)) + 250);
    const res = await storeFetch('checkers', endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': options.parse_api_key },
      body: JSON.stringify({ query: term, page: 0, limit: PAGE_SIZE }),
    });
    // Credits are only charged on success, so count only then.
    setSetting(monthKey(), String(checkersCreditsUsed() + 1));
    setSetting(dayKey(), String(checkersCreditsToday() + 1));
    return parseCheckers(await res.json());
  },
};
