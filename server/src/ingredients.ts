// Turns ingredient lines like "1 ½ cups (200g) plain flour, sifted" into
// { quantity: 1.5, unit: 'cup', name: 'plain flour', note: '(200g), sifted' },
// and merges parsed lines for the shopping list ("2 onions" + "1 large onion"
// → "3 onion"). Deliberately forgiving: anything it can't read stays in name,
// so nothing an imported recipe says is ever lost.

export interface ParsedIngredient {
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
  name: string;
  note: string | null;
}

const UNICODE_FRACTIONS: Record<string, string> = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5',
  '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};

// canonical unit → spellings found in the wild (lowercase, no trailing dot)
const UNIT_ALIASES: Record<string, string[]> = {
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 't'],
  tbsp: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons', 'T'],
  cup: ['cup', 'cups', 'c'],
  ml: ['ml', 'mls', 'millilitre', 'millilitres', 'milliliter', 'milliliters'],
  l: ['l', 'litre', 'litres', 'liter', 'liters', 'lt'],
  g: ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes'],
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  oz: ['oz', 'ounce', 'ounces'],
  'fl oz': ['fl oz', 'fl. oz', 'fluid ounce', 'fluid ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  pint: ['pint', 'pints', 'pt'],
  quart: ['quart', 'quarts', 'qt'],
  pinch: ['pinch', 'pinches'],
  dash: ['dash', 'dashes'],
  clove: ['clove', 'cloves'],
  can: ['can', 'cans'],
  tin: ['tin', 'tins'],
  packet: ['packet', 'packets', 'pack', 'packs', 'pkt'],
  bunch: ['bunch', 'bunches'],
  slice: ['slice', 'slices'],
  sprig: ['sprig', 'sprigs'],
  handful: ['handful', 'handfuls'],
  stick: ['stick', 'sticks'],
  stalk: ['stalk', 'stalks'],
  head: ['head', 'heads'],
  sheet: ['sheet', 'sheets'],
  jar: ['jar', 'jars'],
  sachet: ['sachet', 'sachets'],
  box: ['box', 'boxes'],
  tub: ['tub', 'tubs'],
  bottle: ['bottle', 'bottles'],
  bag: ['bag', 'bags'],
  knob: ['knob', 'knobs'],
  drop: ['drop', 'drops'],
  piece: ['piece', 'pieces', 'pc', 'pcs'],
  dozen: ['dozen', 'doz'],
};

// Case matters only for T (tablespoon) vs t (teaspoon), an old cookbook habit.
const CASE_SENSITIVE = new Set(['T', 't']);

const aliasList: { alias: string; unit: string }[] = Object.entries(UNIT_ALIASES)
  .flatMap(([unit, aliases]) => aliases.map((alias) => ({ alias, unit })))
  .sort((a, b) => b.alias.length - a.alias.length);

// Longest forms first: "1 1/2", then "1/2", then "1.5" / "1,5" / "2".
const NUM = String.raw`\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?`;
const QTY_RE = new RegExp(String.raw`^(${NUM})(?:\s*(?:-|–|—|to|or)\s*(${NUM}))?`, 'i');

function toNumber(s: string): number {
  s = s.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s.replace(',', '.'));
}

export function normalizeLine(line: string): string {
  let s = line.replace(/[   ]/g, ' ');
  // "1½" → "1 1/2", "½" → "1/2"
  s = s.replace(/(\d)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_m, d, f) => (d ? `${d} ${UNICODE_FRACTIONS[f]}` : UNICODE_FRACTIONS[f]));
  s = s.replace(/(\d)\s*⁄\s*(\d)/g, '$1/$2');
  s = s.replace(/^[\s•\-*▢☐□✓·]+/, '');
  return s.replace(/\s+/g, ' ').trim();
}

function matchUnit(rest: string): { unit: string; length: number } | null {
  for (const { alias, unit } of aliasList) {
    const candidate = rest.slice(0, alias.length);
    const same = CASE_SENSITIVE.has(alias) ? candidate === alias : candidate.toLowerCase() === alias.toLowerCase();
    if (!same) continue;
    // Must end at a word boundary: "g" shouldn't eat the start of "garlic".
    let length = alias.length;
    if (rest[length] === '.') length++;
    const next = rest[length];
    if (next === undefined || /[\s,()]/.test(next)) return { unit, length };
  }
  return null;
}

export function parseIngredient(line: string): ParsedIngredient {
  let s = normalizeLine(line);
  let quantity: number | null = null;
  let quantity_max: number | null = null;
  let unit: string | null = null;

  const q = s.match(QTY_RE);
  if (q) {
    quantity = toNumber(q[1]);
    if (q[2]) quantity_max = toNumber(q[2]);
    s = s.slice(q[0].length).trim();
    // "2 x 400g tins" — keep the multiplier as the quantity, the size as a note
    const times = s.match(/^x\s*/i);
    if (times) s = s.slice(times[0].length);
  }

  const u = matchUnit(s);
  if (u && (quantity !== null || ['pinch', 'dash', 'handful', 'knob'].includes(u.unit))) {
    unit = u.unit;
    s = s.slice(u.length).trim();
    // "1 dozen eggs" is just 12 eggs.
    if (unit === 'dozen') {
      unit = null;
      if (quantity !== null) quantity *= 12;
      if (quantity_max !== null) quantity_max *= 12;
    }
  }
  s = s.replace(/^of\s+/i, '');

  // Parentheticals and anything after the first comma are preparation notes.
  const notes: string[] = [];
  s = s.replace(/\(([^)]*)\)/g, (_m, inner) => {
    if (inner.trim()) notes.push(`(${inner.trim()})`);
    return ' ';
  });
  s = s.replace(/\s+/g, ' ').trim();
  const comma = s.indexOf(',');
  if (comma > 0) {
    notes.push(s.slice(comma + 1).trim());
    s = s.slice(0, comma).trim();
  }

  if (Number.isNaN(quantity)) quantity = null;
  if (Number.isNaN(quantity_max)) quantity_max = null;
  const name = s || normalizeLine(line);
  const note = notes.filter(Boolean).join(', ') || null;
  return { quantity, quantity_max, unit, name, note };
}

// ---------- keys, merging, formatting ----------

export const SIZE_WORDS = new Set(['large', 'medium', 'small', 'big', 'fresh', 'extra', 'whole', 'ripe', 'free-range', 'organic']);

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/(oes|ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (/[^su]s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Stable key for "the same thing": "2 Large Onions" and "onion" both → "onion". */
export function nameKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SIZE_WORDS.has(w));
  if (!words.length) return name.toLowerCase().trim();
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(' ');
}

// Base amounts: mass in g, volume in ml (metric spoons and cups).
const CONVERSIONS: Record<string, { family: 'mass' | 'volume'; factor: number }> = {
  g: { family: 'mass', factor: 1 },
  kg: { family: 'mass', factor: 1000 },
  oz: { family: 'mass', factor: 28.35 },
  lb: { family: 'mass', factor: 453.6 },
  ml: { family: 'volume', factor: 1 },
  l: { family: 'volume', factor: 1000 },
  tsp: { family: 'volume', factor: 5 },
  tbsp: { family: 'volume', factor: 15 },
  cup: { family: 'volume', factor: 250 },
  'fl oz': { family: 'volume', factor: 29.57 },
  pint: { family: 'volume', factor: 568 },
  quart: { family: 'volume', factor: 946 },
};

/** 1.5 kg → { amount: 1500, family: 'mass' }; null for counts, cans, bunches… */
export function toBase(quantity: number | null, unit: string | null): { amount: number; family: 'mass' | 'volume' } | null {
  if (quantity === null || !unit || !CONVERSIONS[unit]) return null;
  return { amount: quantity * CONVERSIONS[unit].factor, family: CONVERSIONS[unit].family };
}

export function unitFamily(unit: string | null): string {
  if (!unit) return 'count';
  return CONVERSIONS[unit]?.family ?? unit;
}

export interface Amount {
  quantity: number | null;
  unit: string | null;
}

/**
 * Add two amounts of the same thing, or null if they can't be combined
 * (e.g. 2 cups vs 100 g). A missing quantity ("salt to taste") absorbs into
 * whatever the other side says.
 */
export function addAmounts(a: Amount, b: Amount): Amount | null {
  if (a.quantity === null && b.quantity === null) return a.unit === b.unit ? a : null;
  if (a.quantity === null) return a.unit === null || a.unit === b.unit ? b : null;
  if (b.quantity === null) return b.unit === null || a.unit === b.unit ? a : null;
  if (a.unit === b.unit) return { quantity: a.quantity + b.quantity, unit: a.unit };
  const ca = a.unit ? CONVERSIONS[a.unit] : undefined;
  const cb = b.unit ? CONVERSIONS[b.unit] : undefined;
  if (!ca || !cb || ca.family !== cb.family) return null;
  const base = a.quantity * ca.factor + b.quantity * cb.factor;
  if (ca.family === 'mass') return base >= 1000 ? { quantity: base / 1000, unit: 'kg' } : { quantity: base, unit: 'g' };
  return base >= 1000 ? { quantity: base / 1000, unit: 'l' } : { quantity: base, unit: 'ml' };
}

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'],
];

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

export function formatAmount(a: Amount): string {
  if (a.quantity === null) return a.unit ?? '';
  const q = formatQuantity(a.quantity, a.unit);
  return a.unit ? `${q} ${a.unit}` : q;
}
