import { Amount, nameKey, toBase } from './ingredients';
import { parsePackSize } from './prices/units';

// Pantry amount arithmetic that knows about packs: "4 sachets" of paste
// bought as MIAMI 50G minus "50 g" is 3 sachets; "1 packet" of 500 g mince
// minus 300 g is 200 g. Counts, packs, weights and volumes all meet here.

/** Units that mean "one pack of whatever the item is sold in". */
export const PACK_UNITS = new Set(['packet', 'sachet', 'tin', 'can', 'jar', 'bottle', 'bag', 'box', 'tub']);
const ITEM_UNITS = new Set([null, 'piece', 'pieces', 'each', 'ea']);

// Rough grams per millilitre, for recipes that measure by cup/spoon what
// was bought by weight. Anything not listed is treated like water.
const DENSITY: [string, number][] = [
  ['flour', 0.53],
  ['icing sugar', 0.5],
  ['brown sugar', 0.83],
  ['sugar', 0.85],
  ['rice', 0.8],
  ['oat', 0.4],
  ['butter', 0.96],
  ['oil', 0.92],
  ['honey', 1.4],
  ['cocoa', 0.45],
  ['cacao', 0.45],
  ['salt', 1.2],
  ['baking powder', 0.9],
  ['baking soda', 0.9],
  ['maize meal', 0.6],
  ['cheese', 0.45],
  ['breadcrumb', 0.45],
];

export function density(key: string): { value: number; known: boolean } {
  const hit = DENSITY.find(([word]) => key.includes(word));
  return hit ? { value: hit[1], known: true } : { value: 1, known: false };
}

/** What one pack holds, from the label it was bought as: "MIAMI 50G" → 50 g, "EGGS 18S" → 18 items. */
export interface PackContents {
  amount: number;
  unit: 'g' | 'ml' | 'item';
}

export function packContents(label: string | null | undefined): PackContents | null {
  if (!label) return null;
  const s = parsePackSize(label);
  if (s.perKg) return null;
  if (s.each !== null && (s.unit === 'g' || s.unit === 'ml')) return { amount: s.count * s.each, unit: s.unit };
  if (s.count > 1 && s.each === null) return { amount: s.count, unit: 'item' };
  return null;
}

/** A remembered "one pack is …" as contents: 500 g → 500 g, 24 pieces → 24 items; a pack unit (1 tin) says nothing. */
export function contentsFrom(quantity: number | null, unit: string | null): PackContents | null {
  if (quantity === null || !(quantity > 0)) return null;
  if (ITEM_UNITS.has(unit)) return quantity > 1 ? { amount: quantity, unit: 'item' } : null;
  const b = toBase(quantity, unit);
  return b ? { amount: b.amount, unit: b.family === 'mass' ? 'g' : 'ml' } : null;
}

type Measure = { value: number; unit: 'g' | 'ml' | 'item' | 'pack' };

function measure(a: Amount): Measure | null {
  if (a.quantity === null) return null;
  if (a.unit !== null && PACK_UNITS.has(a.unit)) return { value: a.quantity, unit: 'pack' };
  if (ITEM_UNITS.has(a.unit)) return { value: a.quantity, unit: 'item' };
  const b = toBase(a.quantity, a.unit);
  if (b) return { value: b.amount, unit: b.family === 'mass' ? 'g' : 'ml' };
  return a.unit ? null : { value: a.quantity, unit: 'item' };
}

/** `m` expressed in `unit`, going through the pack's contents or density when needed. */
function convert(m: Measure, unit: Measure['unit'], pack: PackContents | null, name: string): { value: number; approx: boolean } | null {
  if (m.unit === unit) return { value: m.value, approx: false };
  if (m.unit === 'pack') {
    if (!pack) return null;
    return convert({ value: m.value * pack.amount, unit: pack.unit }, unit, pack, name);
  }
  if (unit === 'pack') {
    if (!pack) return null;
    const inner = convert(m, pack.unit, pack, name);
    return inner && { value: inner.value / pack.amount, approx: inner.approx };
  }
  if ((m.unit === 'g' && unit === 'ml') || (m.unit === 'ml' && unit === 'g')) {
    const d = density(nameKey(name)).value;
    return { value: m.unit === 'ml' ? m.value * d : m.value / d, approx: true };
  }
  return null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A base-unit value back into a tidy amount: 1750 g → 1.75 kg, 16 items → 16. */
function tidy(value: number, unit: 'g' | 'ml' | 'item'): Amount {
  if (unit === 'item') return { quantity: r3(value), unit: null };
  if (value >= 1000) return { quantity: r3(value / 1000), unit: unit === 'g' ? 'kg' : 'l' };
  return { quantity: r3(value), unit };
}

function inUnitsOf(have: Amount, value: number, unit: Measure['unit']): Amount {
  if (unit === 'pack') return { quantity: r3(value), unit: have.unit };
  if (unit === 'item') return { quantity: r3(value), unit: have.unit && ITEM_UNITS.has(have.unit) ? have.unit : null };
  // Keep the pantry's own unit (kg stays kg) unless it drops below one.
  const b = toBase(1, have.unit);
  if (b && value / b.amount >= 1) return { quantity: r3(value / b.amount), unit: have.unit };
  return tidy(value, unit);
}

/**
 * What's left of `have` after using `use`. A pack count that no longer
 * comes out whole drops to what's inside (1 packet of 500 g − 300 g = 200 g).
 * Null when it can't be worked out (no amount, or units that don't meet).
 */
export function subtractAmounts(have: Amount, use: Amount, name: string, pack: PackContents | null): { left: Amount; approx: boolean } | null {
  const h = measure(have);
  const u = measure(use);
  if (!h || !u) return null;
  const used = convert(u, h.unit, pack, name);
  if (used) {
    const left = h.value - used.value;
    if (h.unit === 'pack' && Math.abs(left - Math.round(left)) > 0.001 && pack) {
      return { left: tidy(Math.max(0, left) * pack.amount, pack.unit), approx: used.approx };
    }
    return { left: inUnitsOf(have, left, h.unit), approx: used.approx };
  }
  // The pantry side in the recipe's terms instead (a count of eggs vs "1 pack").
  const had = convert(h, u.unit, pack, name);
  if (!had) return null;
  const left = had.value - u.value;
  return { left: u.unit === 'pack' ? { quantity: r3(left), unit: use.unit } : tidy(left, u.unit), approx: had.approx };
}

/**
 * Two amounts of the same item added up, in the pantry's unit where
 * possible: 1 kg mince + 2 packets of 500 g = 2 kg; 4 sachets + 2 packs = 6.
 * Null when they don't meet.
 */
export function addPantryAmounts(have: Amount, add: Amount, name: string, pack: PackContents | null): Amount | null {
  if (have.quantity === null) return add;
  if (add.quantity === null) return have;
  const h = measure(have);
  const a = measure(add);
  if (!h || !a) return null;
  const more = convert(a, h.unit, pack, name);
  if (!more) return null;
  return inUnitsOf(have, h.value + more.value, h.unit);
}
