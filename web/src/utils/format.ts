import type React from 'react';
import { Ingredient } from '../types';

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
];

/** 1.5 → "1½" for cups and counts; grams and millilitres stay decimal. */
export function formatQuantity(q: number, unit: string | null): string {
  if (unit && ['g', 'ml'].includes(unit)) return String(q < 10 ? Math.round(q * 10) / 10 : Math.round(q));
  if (unit && ['kg', 'l'].includes(unit)) return String(Math.round(q * 100) / 100);
  const whole = Math.floor(q);
  const frac = q - whole;
  if (frac < 0.04) return String(whole);
  if (frac > 0.96) return String(whole + 1);
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < 0.04) return whole ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(q * 10) / 10);
}

const NO_PLURAL = new Set(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'oz', 'lb', 'fl oz']);

export function unitLabel(unit: string | null, quantity: number | null): string {
  if (!unit) return '';
  if (NO_PLURAL.has(unit) || quantity === null || quantity <= 1) return unit;
  return /(ch|sh|s|x)$/.test(unit) ? `${unit}es` : `${unit}s`;
}

export function formatAmount(quantity: number | null, unit: string | null): string {
  if (quantity === null) return unit ?? '';
  return [formatQuantity(quantity, unit), unitLabel(unit, quantity)].filter(Boolean).join(' ');
}

/** An ingredient's amount at `factor` × the recipe: "1¾ cups", "2–3", or "" when it has none. */
export function scaledAmount(ing: Pick<Ingredient, 'quantity' | 'quantity_max' | 'unit'>, factor: number): string {
  if (ing.quantity === null) return ing.unit ?? '';
  const q = ing.quantity * factor;
  const max = ing.quantity_max !== null ? ing.quantity_max * factor : null;
  const unit = unitLabel(ing.unit, max ?? q);
  return `${formatQuantity(q, ing.unit)}${max !== null ? `–${formatQuantity(max, ing.unit)}` : ''}${unit ? ` ${unit}` : ''}`;
}

/** What's at home, with what one pack holds when it's counted in packs: "2 bottles of 750 ml". */
export function pantryAmount(i: { pantry_quantity: number | null; pantry_unit: string | null; container?: string | null; size_quantity?: number | null; size_unit?: string | null }): string {
  const base = formatAmount(i.pantry_quantity, i.pantry_unit);
  const counted = i.pantry_unit && i.pantry_unit === i.container;
  if (!counted || i.size_quantity == null) return base;
  return `${base} of ${formatAmount(i.size_quantity, i.size_unit === 'piece' ? null : i.size_unit ?? null)}${i.size_unit === 'piece' ? ' pieces' : ''}`;
}

export function formatMinutes(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Group consecutive rows by their section heading. */
export function bySection<T extends { section: string | null }>(rows: T[]): { section: string | null; rows: T[] }[] {
  const groups: { section: string | null; rows: T[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.section === row.section) last.rows.push(row);
    else groups.push({ section: row.section, rows: [row] });
  }
  return groups;
}


/** A stable hue per recipe name, so photo-less recipes don't all look the same. */
export function placeholderStyle(name: string): React.CSSProperties {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { ['--h' as string]: String(h) };
}

export const rand = (n: number | null | undefined) => (n == null ? '—' : `R${n.toFixed(2)}`);

/** 4 / item → "R4.00 each"; 0.125 / g → "R125.00/kg"; 0.02 / ml → "R20.00/L". */
export function unitPriceLabel(unitPrice: number | null, priceUnit: string | null): string | null {
  if (unitPrice == null || !priceUnit) return null;
  if (priceUnit === 'g') return `${rand(unitPrice * 1000)}/kg`;
  if (priceUnit === 'ml') return `${rand(unitPrice * 1000)}/L`;
  return `${rand(unitPrice)} each`;
}

/** Whole days from today (local) to a YYYY-MM-DD date: 0 today, negative once past. */
export function daysUntil(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const now = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

/** "Expired 2 days ago", "Use today", "Use by tomorrow", "Use within 5 days", "Use by 12 Oct". */
export function expiryLabel(date: string): { text: string; level: 'past' | 'soon' | 'ok' } {
  const n = daysUntil(date);
  if (n < 0) return { text: n === -1 ? 'Expired yesterday' : `Expired ${-n} days ago`, level: 'past' };
  if (n === 0) return { text: 'Use today', level: 'soon' };
  if (n === 1) return { text: 'Use by tomorrow', level: 'soon' };
  if (n <= 7) return { text: `Use within ${n} days`, level: 'soon' };
  const [y, m, d] = date.split('-').map(Number);
  const when = new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  return { text: `Use by ${when}`, level: 'ok' };
}
