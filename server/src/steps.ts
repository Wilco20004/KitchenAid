import { addAmounts, formatQuantity, SIZE_WORDS } from './ingredients';

// Amounts in method steps that follow the ingredient list: a step written as
// "Sift {{flour}} and {{salt}}" reads "Sift 1¾ cup plain flour and ½ tsp salt",
// scaled to the servings shown and updated whenever the ingredient changes.
//
//   {{flour}}            amount and name       "1¾ cup plain flour"
//   {{flour.amount}}     just the amount       "1¾ cup"
//   {{flour.name}}       just the name         "plain flour"
//   {{chips*1/6}}        part of it            "¼ cup dark chocolate chips"
//   {{chips.amount*1/6}} part, amount only     "¼ cup"
//
// {{ingredient.flour.total}} is accepted too (.total = the whole line).
// Short names belong to items (Cake Flour → flour), so an item used twice in
// a recipe (sugar for the batter and the topping) gives the total of both.
// The web app has its own copy of this (web/src/utils/steps.ts) so the
// servings stepper re-renders without a round trip; keep the two in step.

export interface RefIngredient {
  ref: string | null;
  name: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
}

export const TEMPLATE_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const INNER_RE = /^(?:ingredients?\.)?([a-z0-9][a-z0-9-]*)(?:\.(amount|qty|name|total|all))?(?:\s*\*\s*(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|\d+\s+\d+\/\d+))?(?:\.(amount|qty|name|total|all))?$/i;

export interface TemplateRef {
  ref: string;
  field: 'all' | 'amount' | 'name';
  portion: number;
}

function toNumber(s: string): number {
  s = s.trim().replace(',', '.');
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s);
}

/** What's inside one {{…}}, or null if it isn't a reference. */
export function parseTemplate(inner: string): TemplateRef | null {
  const m = inner.trim().match(INNER_RE);
  if (!m) return null;
  const f = (m[2] ?? m[4] ?? 'all').toLowerCase();
  const portion = m[3] ? toNumber(m[3]) : 1;
  if (!(portion > 0)) return null;
  return { ref: m[1].toLowerCase(), field: f === 'amount' || f === 'qty' ? 'amount' : f === 'name' ? 'name' : 'all', portion };
}

/** Every ref a piece of text uses, valid or not. */
export function refsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TEMPLATE_RE)) out.push(parseTemplate(m[1])?.ref ?? m[1].trim());
  return out;
}

function amountText(ing: RefIngredient, factor: number): string {
  if (ing.quantity === null) return ing.unit ?? '';
  const q = formatQuantity(ing.quantity * factor, ing.unit);
  const max = ing.quantity_max !== null ? `–${formatQuantity(ing.quantity_max * factor, ing.unit)}` : '';
  return `${q}${max}${ing.unit ? ` ${ing.unit}` : ''}`;
}

/** Ingredients by short name, the same item's lines added up ("1 cup" + "½ cup" sugar → 1½ cup). */
export function byRef(ingredients: RefIngredient[]): Map<string, RefIngredient> {
  const map = new Map<string, RefIngredient>();
  for (const i of ingredients) {
    if (!i.ref) continue;
    const prev = map.get(i.ref);
    if (!prev) {
      map.set(i.ref, { ...i });
      continue;
    }
    const sum = prev.quantity_max === null && i.quantity_max === null ? addAmounts(prev, i) : null;
    // Amounts that can't be added (2 tbsp and 100 g) keep the first.
    if (sum) map.set(i.ref, { ...prev, quantity: sum.quantity, unit: sum.unit });
  }
  return map;
}

/** A step with its {{refs}} filled in at `factor` × the recipe's amounts. Unknown refs stay as written. */
export function renderStep(text: string, ingredients: RefIngredient[], factor = 1): string {
  const refs = byRef(ingredients);
  return text.replace(TEMPLATE_RE, (whole, inner: string) => {
    const t = parseTemplate(inner);
    const ing = t && refs.get(t.ref);
    if (!t || !ing) return whole;
    if (t.field === 'name') return ing.name;
    const amount = amountText(ing, factor * t.portion);
    if (t.field === 'amount') return amount || ing.name;
    return [amount, ing.name].filter(Boolean).join(' ');
  });
}

/** Rewrites {{old…}} to {{new…}} in a step (when an ingredient's short name changes). */
export function renameRef(text: string, from: string, to: string): string {
  return text.replace(TEMPLATE_RE, (whole, inner: string) => {
    const t = parseTemplate(inner);
    if (!t || t.ref !== from) return whole;
    return whole.replace(new RegExp(`(\\{\\{\\s*(?:ingredients?\\.)?)${from}`, 'i'), `$1${to}`);
  });
}

// Last words that name a form, not the ingredient: cocoa powder, vanilla extract.
const GENERIC_TAIL = new Set(['powder', 'extract', 'essence', 'granules', 'granule', 'crystals', 'flakes', 'leaves', 'pods', 'process']);

const cleanRef = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

/** A tidy, valid ref from whatever was typed ("Brown Sugar" → "brown-sugar"), or null. */
export function sanitizeRef(s: string | null | undefined): string | null {
  const r = cleanRef(s ?? '');
  return r && /^[a-z0-9]/.test(r) ? r.slice(0, 32) : null;
}

/**
 * A short name for an ingredient that no other ingredient in the recipe has:
 * the last word ("plain flour" → flour), then the last two ("brown-sugar"),
 * then a number. "baking soda / bi-carb" uses what comes before the slash,
 * and a last word that says little goes ("cocoa powder" → cocoa).
 */
export function makeRef(name: string, taken: Set<string>): string {
  const words = name
    .split(/[/,(]/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SIZE_WORDS.has(w));
  while (words.length > 1 && GENERIC_TAIL.has(words[words.length - 1])) words.pop();
  const tries = [words.slice(-1), words.slice(-2), words].map((w) => cleanRef(w.join('-'))).filter(Boolean);
  for (const t of tries) if (!taken.has(t)) return t;
  const base = tries[0] || 'item';
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}
