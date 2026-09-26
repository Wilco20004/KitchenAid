// Pack-size parsing and unit pricing. Stores write sizes every which way —
// "410 g", "410g, Pack of 6", "12 x 410 g", "6 x 3 kg", "9 Rolls",
// "2-Ply 18's", "Bananas per kg" — and comparing shelves only works once
// every product is reduced to: how many items, how much in each, of what.

export type MeasureUnit = 'g' | 'ml' | 'sheet';

export interface PackSize {
  count: number; // items in the pack (1 for a single can)
  each: number | null; // quantity per item in `unit`
  unit: MeasureUnit | null;
  perKg: boolean; // loose produce priced by weight
}

export interface UnitPrices {
  perItem: number | null; // price of one can / roll / bottle
  perMeasure: number | null; // per kg, per litre or per 100 sheets
  measureLabel: 'kg' | 'L' | '100 sheets' | null;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const MASS_VOL = String.raw`(kg|g|gr|gram|grams|ml|l|lt|ltr|litre|litres|liter|liters)`;

function num(s: string): number {
  return Number(s.replace(',', '.'));
}

function toBase(qty: number, unit: string): { each: number; unit: MeasureUnit } {
  const u = unit.toLowerCase();
  if (u === 'kg') return { each: qty * 1000, unit: 'g' };
  if (u.startsWith('g')) return { each: qty, unit: 'g' };
  if (u === 'ml') return { each: qty, unit: 'ml' };
  return { each: qty * 1000, unit: 'ml' };
}

export function parsePackSize(text: string): PackSize {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const size: PackSize = { count: 1, each: null, unit: null, perKg: false };

  if (/\bper kg\b|\/kg\b|\bloose\b/.test(t)) {
    size.perKg = true;
    size.each = 1000;
    size.unit = 'g';
    return size;
  }

  // "12 x 410 g", "6x3kg"
  const multi = t.match(new RegExp(String.raw`(\d+) ?x ?${NUM} ?${MASS_VOL}\b`));
  if (multi) {
    size.count = Number(multi[1]);
    Object.assign(size, toBase(num(multi[2]), multi[3]));
  } else {
    // A lone mass/volume; if there are several ("500g + 100g free") the
    // first one is the pack's stated size.
    const single = t.match(new RegExp(String.raw`(?:^|[^\d.,])${NUM} ?${MASS_VOL}\b`));
    if (single) Object.assign(size, toBase(num(single[1]), single[2]));
  }

  // Toilet paper and the like: "9 rolls", "4 x 200 sheets".
  const sheets = t.match(/(\d+) ?sheets?\b/);
  if (sheets && !size.unit) {
    size.each = Number(sheets[1]);
    size.unit = 'sheet';
  }

  const COUNT_NOUN = String.raw`(?:rolls?|cans?|tins?|bottles?|pieces?|pcs|sachets?|bags?|units?|pack|pac|pk|ea)\b`;
  // Makro: "Pack of 2 x 24 Rolls" is two 24-roll packs. But its listings
  // also say "Pack of 72 x 72 Rolls" for a single 72-roll bale (the prices
  // only make sense that way), so equal numbers count once.
  const packs = !multi && t.match(new RegExp(String.raw`(\d+) ?x ?(\d+) ?${COUNT_NOUN}`));
  if (packs) {
    const [a, b] = [Number(packs[1]), Number(packs[2])];
    size.count = a === b ? a : a * b;
  } else if (!multi) {
    const count =
      t.match(new RegExp(String.raw`(\d+) ?${COUNT_NOUN}`)) ||
      t.match(/pack of (\d+)/) ||
      t.match(/\b(\d+) ?'?s\b/);
    if (count) size.count = Number(count[1]);
  }

  if (!(size.count >= 1)) size.count = 1;
  return size;
}

export function unitPrices(price: number, size: PackSize): UnitPrices {
  if (size.perKg) return { perItem: null, perMeasure: round(price), measureLabel: 'kg' };

  const perItem = round(price / size.count);
  if (!size.unit || !size.each) return { perItem, perMeasure: null, measureLabel: null };

  const total = size.count * size.each;
  if (size.unit === 'sheet') return { perItem, perMeasure: round((price / total) * 100), measureLabel: '100 sheets' };
  return { perItem, perMeasure: round((price / total) * 1000), measureLabel: size.unit === 'g' ? 'kg' : 'L' };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
