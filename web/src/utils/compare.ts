import { Basis, Product } from '../types';

export interface Filters {
  includeWords: string;
  excludeWords: string;
  stores: Set<string>;
  inStockOnly: boolean;
}

function words(s: string): string[] {
  return s.toLowerCase().split(/[\s,]+/).filter(Boolean);
}

export function applyFilters(products: Product[], f: Filters): Product[] {
  const must = words(f.includeWords);
  const mustNot = words(f.excludeWords);
  return products.filter((p) => {
    if (!f.stores.has(p.store)) return false;
    if (f.inStockOnly && p.inStock === false) return false;
    const hay = `${p.brand ?? ''} ${p.name} ${p.sizeText ?? ''}`.toLowerCase();
    return must.every((w) => hay.includes(w)) && !mustNot.some((w) => hay.includes(w));
  });
}

export function basisValue(p: Product, basis: Basis): number | null {
  if (basis === 'measure') return p.perMeasure;
  if (basis === 'item') return p.perItem;
  return p.price;
}

export function basisUnit(p: Product, basis: Basis): string {
  if (basis === 'measure') return p.measureLabel ? `/ ${p.measureLabel}` : '';
  if (basis === 'item') return p.packCount > 1 ? '/ each' : 'each';
  return '';
}

// Per-measure prices only compare like with like (a kg is not a litre), so
// products sort by unit first, the unit most results share leading.
export function sortByBasis(products: Product[], basis: Basis): Product[] {
  const labelCounts = new Map<string, number>();
  if (basis === 'measure') {
    for (const p of products) if (p.measureLabel) labelCounts.set(p.measureLabel, (labelCounts.get(p.measureLabel) ?? 0) + 1);
  }
  const labelRank = (p: Product) => (basis === 'measure' && p.measureLabel ? -(labelCounts.get(p.measureLabel) ?? 0) : 0);
  return [...products].sort((a, b) => {
    const va = basisValue(a, basis);
    const vb = basisValue(b, basis);
    if (va == null && vb == null) return a.price - b.price;
    if (va == null) return 1;
    if (vb == null) return -1;
    return labelRank(a) - labelRank(b) || va - vb;
  });
}

// A unit price under a quarter of the median for its unit is usually a
// store typo in the size ("36 kg" beans for R139.95), not a bargain. Such
// products are flagged and kept out of the "cheapest" cards.
export function suspectIds(products: Product[], basis: Basis): Set<string> {
  const out = new Set<string>();
  if (basis === 'pack') return out;
  const group = (p: Product) => (basis === 'measure' ? p.measureLabel : 'item');
  const byGroup = new Map<string, number[]>();
  for (const p of products) {
    const v = basisValue(p, basis);
    const g = group(p);
    if (v != null && g) byGroup.set(g, [...(byGroup.get(g) ?? []), v]);
  }
  const medians = new Map<string, number>();
  for (const [g, vals] of byGroup) {
    if (vals.length < 4) continue;
    const s = [...vals].sort((a, b) => a - b);
    medians.set(g, s[Math.floor(s.length / 2)]);
  }
  for (const p of products) {
    const g = group(p);
    const m = g ? medians.get(g) : undefined;
    const v = basisValue(p, basis);
    if (m && v != null && v < m / 4) out.add(p.id);
  }
  return out;
}

export function money(n: number | null | undefined): string {
  return n == null ? '—' : `R${n.toFixed(2)}`;
}

export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
