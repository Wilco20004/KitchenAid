import { toBase } from '../ingredients';
import { ProductResult, search } from './search';
import { parsePackSize } from './units';
import { activeStores } from './stores';
import { differentProduct } from '../productForms';

// "What would this shopping list cost at each shop?" For every item, each
// store's results are narrowed to products whose name actually contains the
// item's words, then the one that covers the amount needed most cheaply wins
// (1.5 kg mince → two 750 g packs, not one). It's an estimate: store search
// is fuzzy, so every pick is shown and the AI tools get the runners-up too.

export interface ItemNeed {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface Pick {
  product: ProductResult;
  packs: number;
  cost: number;
}

export interface StoreMatch {
  store: string;
  storeName: string;
  best: Pick | null;
  alternatives: Pick[];
  error: string | null;
}

export interface ItemMatch {
  name: string;
  term: string;
  stores: StoreMatch[];
}

const STOP = new Set(['and', 'of', 'the', 'for', 'with', 'fresh', 'large', 'small', 'medium', 'or']);

// Store search happily returns an "egg container" for eggs. Products with
// these words are kitchenware, not the food — skipped unless the item asked
// for is itself one of them.
const KITCHENWARE = [
  'container', 'holder', 'rack', 'storage', 'organiser', 'organizer', 'tray', 'poacher', 'boiler', 'cooker', 'separator',
  'timer', 'mould', 'mold', 'dispenser', 'maker', 'slicer', 'cutter', 'grinder', 'toy', 'costume', 'candle', 'novelty',
  'kitchenware', 'utensil', 'spoon', 'whisk', 'peeler', 'grater', 'jar opener', 'basket', 'shaker', 'mill',
];

export function isKitchenware(productName: string, itemTerm: string): boolean {
  const name = productName.toLowerCase();
  return KITCHENWARE.some((w) => new RegExp(`\\b${w}s?\\b`).test(name) && !itemTerm.includes(w));
}

/** "Maize meal (pap)" → "maize meal": what to type into a shop's search box. */
export function searchTerm(name: string): string {
  return name
    .replace(/\([^)]*\)?/g, ' ')
    .replace(/[^\p{L}\p{N}\s&'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3);
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function keyWords(term: string): string[] {
  return term
    .split(/[\s&'-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(stem);
}

/**
 * Every item word is a whole word of the product (stemmed, so "potato"
 * finds "Potatoes") — not just somewhere inside it, or "rice" would find
 * "Coricelli olive oil".
 */
export function hasWords(words: string[], productText: string): boolean {
  const have = productText.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  return words.every((w) => have.some((h) => h === w || (w.length >= 4 && h.startsWith(w))));
}

// Words that make a product a variety of the thing rather than the thing:
// "onions" should find a bag of onions before spring or pickling onions.
const VARIETY = ['spring', 'baby', 'mini', 'cocktail', 'cherry', 'cubed', 'cubes', 'diced', 'sliced', 'grated', 'shredded', 'marinated', 'crumbed', 'frozen', 'dried', 'instant', 'readymade'];

function varietyPenalty(productName: string, term: string): number {
  const name = productName.toLowerCase();
  return VARIETY.filter((w) => new RegExp(`\\b${w}\\b`).test(name) && !term.includes(w)).length;
}

function packTotal(p: ProductResult): { amount: number; family: 'mass' | 'volume' } | null {
  const size = parsePackSize(p.sizeOverride ?? [p.sizeText, p.name].filter(Boolean).join(' '));
  if (!size.unit || !size.each || size.unit === 'sheet') return null;
  return { amount: size.count * size.each, family: size.unit === 'g' ? 'mass' : 'volume' };
}

/** Cost of buying enough of p to cover the need. Loose produce is priced per kg. */
export function costFor(p: ProductResult, need: ItemNeed): { packs: number; cost: number } {
  const wanted = toBase(need.quantity, need.unit);
  if (p.measureLabel === 'kg' && p.perMeasure !== null && p.packCount === 1 && p.price === p.perMeasure && wanted?.family === 'mass') {
    return { packs: 1, cost: round((wanted.amount / 1000) * p.price) };
  }
  if (wanted) {
    const total = packTotal(p);
    if (total && total.family === wanted.family) {
      const packs = Math.max(1, Math.ceil(wanted.amount / total.amount - 0.02));
      return { packs, cost: round(packs * p.price) };
    }
    return { packs: 1, cost: p.price };
  }
  // A plain count ("3 onions", "4 burger buns"): a pack of 6 covers 4.
  if (need.quantity && need.quantity > 1 && !need.unit) {
    const packs = Math.max(1, Math.ceil(need.quantity / Math.max(1, p.packCount)));
    return { packs, cost: round(packs * p.price) };
  }
  return { packs: 1, cost: p.price };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function matchItem(need: ItemNeed, opts: { alternatives?: number } = {}): Promise<ItemMatch> {
  const term = searchTerm(need.name);
  const words = keyWords(term);
  const result = await search(term);

  const stores = activeStores().map((s): StoreMatch => {
    const status = result.stores.find((x) => x.store === s.id);
    // Stores list the most relevant first; past the top 20 it's mostly noise.
    const relevant = result.products
      .filter((p) => p.store === s.id && p.rank < 20 && p.inStock !== false)
      .filter((p) => {
        return hasWords(words, `${p.brand ?? ''} ${p.name}`) && !isKitchenware(p.name, term) && !differentProduct(term, p.name);
      });
    const picks = relevant
      .map((product) => ({ product, ...costFor(product, need), penalty: varietyPenalty(product.name, term) }))
      .sort((a, b) => a.penalty - b.penalty || a.cost - b.cost || a.product.rank - b.product.rank)
      .map(({ penalty: _p, ...pick }) => pick);
    return {
      store: s.id,
      storeName: s.name,
      best: picks[0] ?? null,
      alternatives: picks.slice(1, 1 + (opts.alternatives ?? 0)),
      error: status?.error ?? (status?.pausedUntil ? 'store paused after refusing a request' : null),
    };
  });
  return { name: need.name, term, stores };
}

export interface BasketTotals {
  store: string;
  storeName: string;
  total: number;
  found: number;
  missing: string[];
}

export function basketTotals(matches: ItemMatch[]): { stores: BasketTotals[]; cheapestMix: { total: number; missing: string[] } } {
  const stores = activeStores().map((s) => {
    let total = 0;
    const missing: string[] = [];
    for (const m of matches) {
      const pick = m.stores.find((x) => x.store === s.id)?.best;
      if (pick) total += pick.cost;
      else missing.push(m.name);
    }
    return { store: s.id, storeName: s.name, total: round(total), found: matches.length - missing.length, missing };
  });
  let mix = 0;
  const mixMissing: string[] = [];
  for (const m of matches) {
    const costs = m.stores.map((x) => x.best?.cost).filter((c): c is number => c !== undefined);
    if (costs.length) mix += Math.min(...costs);
    else mixMissing.push(m.name);
  }
  return { stores, cheapestMix: { total: round(mix), missing: mixMissing } };
}
