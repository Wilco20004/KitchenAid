import { formatQuantity, unitLabel } from './format';

// Amounts in method steps: "Sift {{flour}}" shows "Sift 1¾ cups plain flour",
// scaled to the servings on screen. The server has the same rules in
// server/src/steps.ts (for AI assistants); keep the two in step.
//
//   {{flour}}  {{flour.amount}}  {{flour.name}}  {{chips*1/6}}  {{chips.amount*1/6}}
//   {{ingredient.flour.total}} works too.
// Short names belong to items, so an item used twice in a recipe (sugar for
// the batter and the topping) gives the total of both.

export interface RefIngredient {
  ref: string | null;
  name: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
}

export const TEMPLATE_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const INNER_RE = /^(?:ingredients?\.)?([a-z0-9][a-z0-9-]*)(?:\.(amount|qty|name|total|all))?(?:\s*\*\s*(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|\d+\s+\d+\/\d+))?(?:\.(amount|qty|name|total|all))?$/i;

interface TemplateRef {
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

export function parseTemplate(inner: string): TemplateRef | null {
  const m = inner.trim().match(INNER_RE);
  if (!m) return null;
  const f = (m[2] ?? m[4] ?? 'all').toLowerCase();
  const portion = m[3] ? toNumber(m[3]) : 1;
  if (!(portion > 0)) return null;
  return { ref: m[1].toLowerCase(), field: f === 'amount' || f === 'qty' ? 'amount' : f === 'name' ? 'name' : 'all', portion };
}

function amountText(ing: RefIngredient, factor: number): string {
  if (ing.quantity === null) return ing.unit ?? '';
  const q = ing.quantity * factor;
  const max = ing.quantity_max !== null ? ing.quantity_max * factor : null;
  const unit = unitLabel(ing.unit, max ?? q);
  return `${formatQuantity(q, ing.unit)}${max !== null ? `–${formatQuantity(max, ing.unit)}` : ''}${unit ? ` ${unit}` : ''}`;
}

export type StepPart = { text: string } | { value: string; ref: string } | { missing: string };

const BASE: Record<string, [string, number]> = {
  g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000], tsp: ['ml', 5], tbsp: ['ml', 15], cup: ['ml', 250],
};

/** Ingredients by short name, the same item's lines added up (1 cup + ½ cup sugar → 1½ cups; 1 tbsp + 1 tsp → 20 ml). */
function byShortName(ingredients: RefIngredient[]): Map<string, RefIngredient> {
  const map = new Map<string, RefIngredient>();
  for (const i of ingredients) {
    if (!i.ref) continue;
    const prev = map.get(i.ref);
    if (!prev) {
      map.set(i.ref, { ...i });
      continue;
    }
    if (prev.quantity === null || i.quantity === null || prev.quantity_max !== null || i.quantity_max !== null) continue;
    if (prev.unit === i.unit) {
      map.set(i.ref, { ...prev, quantity: prev.quantity + i.quantity });
      continue;
    }
    const a = prev.unit ? BASE[prev.unit] : undefined;
    const b = i.unit ? BASE[i.unit] : undefined;
    // Amounts that can't be added (2 tbsp and 100 g) keep the first.
    if (!a || !b || a[0] !== b[0]) continue;
    const total = prev.quantity * a[1] + i.quantity * b[1];
    map.set(i.ref, { ...prev, ...(total >= 1000 ? { quantity: total / 1000, unit: a[0] === 'g' ? 'kg' : 'l' } : { quantity: total, unit: a[0] }) });
  }
  return map;
}

/** A step split into plain text and filled-in amounts (missing refs flagged), at `factor` × the recipe. */
export function stepParts(text: string, ingredients: RefIngredient[], factor = 1): StepPart[] {
  const byRef = byShortName(ingredients);
  const parts: StepPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TEMPLATE_RE)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    last = m.index! + m[0].length;
    const t = parseTemplate(m[1]);
    const ing = t && byRef.get(t.ref);
    if (!t || !ing) {
      parts.push({ missing: m[0] });
      continue;
    }
    const amount = amountText(ing, factor * t.portion);
    const value = t.field === 'name' ? ing.name : t.field === 'amount' ? amount || ing.name : [amount, ing.name].filter(Boolean).join(' ');
    parts.push({ value, ref: t.ref });
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The refs a step uses that no ingredient has. */
export function missingRefs(text: string, refs: Set<string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TEMPLATE_RE)) {
    const t = parseTemplate(m[1]);
    if (!t || !refs.has(t.ref)) out.push(m[0]);
  }
  return out;
}

/** What a short name may be: lower case letters, digits and dashes. */
export function sanitizeRef(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 32);
}
