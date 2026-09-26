import { toBase } from './ingredients';
import { getItem, latestPricesByStore, PaidPrice } from './items';
import { pricedItemFor } from './costing';

// "What would this list cost at the shops I actually use?" from prices on
// your own slips — the only fair way to include Checkers and SPAR, which
// don't publish prices a program may read.

export interface NeedLine {
  item_id?: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Whole packs needed to cover the amount, at the price paid for one pack. */
export function packsFor(p: PaidPrice, need: NeedLine): { packs: number; cost: number } {
  const perPack = p.unit_price > 0 ? p.pack_price / p.unit_price : 1; // g, ml or items in one pack
  const base = toBase(need.quantity, need.unit);
  let wanted: number | null = null;
  if (base && ((base.family === 'mass' && p.price_unit === 'g') || (base.family === 'volume' && p.price_unit === 'ml'))) wanted = base.amount;
  else if (!need.unit && need.quantity && p.price_unit === 'item') wanted = need.quantity;
  let packs = wanted ? Math.max(1, Math.ceil(wanted / perPack - 0.02)) : 1;
  // "2 onion soup" against a 50 g sachet: a plain count means that many packs.
  if (!wanted && !need.unit && need.quantity && need.quantity > 1) packs = Math.ceil(need.quantity);
  return { packs, cost: r2(packs * p.pack_price) };
}

export function paidPricesFor(lines: NeedLine[]) {
  const items = lines.map((line) => {
    // The list line's own item if it has prices; otherwise the priced item its
    // words point at — "milk" finds "Clover Full Cream Milk" from the slips.
    const own = line.item_id ? getItem(line.item_id) : undefined;
    const item = own && latestPricesByStore(own.id).some((p) => p.store) ? own : pricedItemFor(line.name) ?? own;
    const prices = item
      ? latestPricesByStore(item.id)
          .filter((p) => p.store)
          .map((p) => ({ store: p.store!, ...packsFor(p, line), pack_price: p.pack_price, pack_label: p.pack_label, seen_at: p.seen_at }))
      : [];
    return { name: line.name, item: item?.name ?? null, prices };
  });

  const storeNames = [...new Set(items.flatMap((i) => i.prices.map((p) => p.store)))];
  const stores = storeNames
    .map((store) => {
      let total = 0;
      const missing: string[] = [];
      for (const i of items) {
        const p = i.prices.find((x) => x.store === store);
        if (p) total += p.cost;
        else missing.push(i.name);
      }
      return { store, total: r2(total), found: items.length - missing.length, missing };
    })
    .sort((a, b) => b.found - a.found || a.total - b.total);
  return { stores, items };
}
