import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

// Almost every recipe site (AllRecipes, BBC Good Food, NYT Cooking, Food
// Network, Serious Eats, Jamie Oliver, Woolworths TASTE, Food24, WordPress
// sites using WP Recipe Maker / Tasty Recipes, ...) embeds a schema.org Recipe
// as JSON-LD for Google's recipe cards. That's what we read — no per-site
// scrapers to rot. Microdata is the fallback for older sites, and failing
// both, the page title and photo give a draft to finish by hand.

export interface RecipeDraft {
  name: string;
  description: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  source_url: string | null;
  source_name: string | null;
  image_url: string | null;
  ingredients: { section: string | null; raw: string }[];
  steps: { section: string | null; text: string }[];
  tags: string[];
  notes: string | null;
}

export interface ScrapeResult {
  draft: RecipeDraft;
  /** 'json-ld' | 'microdata' | 'page' (no recipe data, title/photo only) */
  method: string;
}

const clean = (s: unknown): string =>
  typeof s === 'string' || typeof s === 'number'
    ? cheerio
        .load(`<div>${String(s)}</div>`)('div')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
    : '';

export function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^P(?:(\d+)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+)S)?$/i);
  if (!m) return null;
  const minutes = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Math.round(Number(m[4] || 0) / 60);
  return minutes > 0 ? Math.round(minutes) : null;
}

function parseYield(value: unknown): number | null {
  const list = Array.isArray(value) ? value : [value];
  for (const v of list) {
    const m = String(v ?? '').match(/\d+/);
    if (m && Number(m[0]) > 0 && Number(m[0]) < 500) return Number(m[0]);
  }
  return null;
}

function pickImage(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    // Sites list several crops; the widest one looks best as a header.
    const candidates = value
      .map((v) => (typeof v === 'string' ? { url: v, width: 0 } : { url: pickImage(v), width: Number(v?.width) || 0 }))
      .filter((c): c is { url: string; width: number } => Boolean(c.url));
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0]?.url ?? null;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return pickImage(o.url ?? o.contentUrl ?? o['@id']);
  }
  return null;
}

function hasType(node: any, type: string): boolean {
  const t = node?.['@type'];
  return Array.isArray(t) ? t.some((x) => String(x).toLowerCase() === type.toLowerCase()) : String(t).toLowerCase() === type.toLowerCase();
}

function findRecipeNode(data: any, depth = 0): any | null {
  if (!data || typeof data !== 'object' || depth > 6) return null;
  if (Array.isArray(data)) {
    for (const d of data) {
      const r = findRecipeNode(d, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (hasType(data, 'Recipe')) return data;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const r = findRecipeNode(data[key], depth + 1);
    if (r) return r;
  }
  return null;
}

/** Split a block of instruction text/HTML into steps. Used for JSON-LD strings and Grocy's HTML. */
export function htmlToSteps(html: string): string[] {
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  const items = $('#root li').toArray();
  const blocks = items.length ? items : $('#root p').toArray();
  let lines: string[];
  if (blocks.length) {
    lines = blocks.map((el) => $(el).text());
  } else {
    $('#root br').replaceWith('\n');
    lines = $('#root').text().split(/\n+/);
  }
  return lines
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .map((l) => l.replace(/^(?:step\s*)?\d+[.):]\s*/i, ''))
    .filter(Boolean);
}

function readInstructions(value: unknown, section: string | null = null, out: RecipeDraft['steps'] = []): RecipeDraft['steps'] {
  if (!value) return out;
  if (typeof value === 'string') {
    for (const text of htmlToSteps(value.includes('<') ? value : value.replace(/\r?\n/g, '<br>'))) out.push({ section, text });
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) readInstructions(v, section, out);
    return out;
  }
  if (typeof value === 'object') {
    const o = value as any;
    if (hasType(o, 'HowToSection') || (o.itemListElement && !o.text)) {
      readInstructions(o.itemListElement, clean(o.name).replace(/:\s*$/, '') || section, out);
    } else {
      const text = clean(o.text ?? o.name ?? o.description);
      if (text) out.push({ section, text });
    }
  }
  return out;
}

function readTags(node: any): string[] {
  const raw: string[] = [];
  for (const key of ['recipeCategory', 'recipeCuisine', 'keywords']) {
    const v = node[key];
    const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
    raw.push(...list.map((x: unknown) => clean(x).toLowerCase()));
  }
  return [...new Set(raw.filter((t) => t && t.length <= 25 && !/recipe|^\d+$/.test(t)))].slice(0, 6);
}

function fromJsonLd(node: any): Omit<RecipeDraft, 'source_url' | 'source_name'> {
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : Array.isArray(node.ingredients) ? node.ingredients : [])
    .map((i: unknown) => clean(i))
    .filter(Boolean)
    .map((raw: string) => ({ section: null, raw }));
  const prep = parseDuration(node.prepTime);
  const cook = parseDuration(node.cookTime);
  return {
    name: clean(node.name) || 'Imported recipe',
    description: clean(node.description) || null,
    servings: parseYield(node.recipeYield ?? node.yield),
    prep_minutes: prep,
    cook_minutes: cook,
    total_minutes: parseDuration(node.totalTime) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null),
    image_url: pickImage(node.image),
    ingredients,
    steps: readInstructions(node.recipeInstructions),
    tags: readTags(node),
    notes: null,
  };
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Some CMSes emit raw newlines/tabs inside strings, which strict JSON forbids.
    try {
      return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return null;
    }
  }
}

function fromMicrodata($: cheerio.CheerioAPI): Omit<RecipeDraft, 'source_url' | 'source_name'> | null {
  const root = $('[itemtype*="schema.org/Recipe" i]').first();
  if (!root.length) return null;
  const prop = (name: string) => root.find(`[itemprop="${name}"]`);
  const val = (el: cheerio.Cheerio<AnyNode>) => el.attr('content') ?? el.attr('datetime') ?? el.attr('src') ?? el.text();
  const ingredients = [...prop('recipeIngredient').toArray(), ...prop('ingredients').toArray()]
    .map((el) => clean($(el).text()))
    .filter(Boolean)
    .map((raw) => ({ section: null, raw }));
  const stepEls = prop('recipeInstructions');
  const steps: RecipeDraft['steps'] = [];
  stepEls.each((_i, el) => {
    for (const text of htmlToSteps($(el).html() ?? '')) steps.push({ section: null, text });
  });
  const prep = parseDuration(val(prop('prepTime').first()));
  const cook = parseDuration(val(prop('cookTime').first()));
  return {
    name: clean(val(prop('name').first())) || 'Imported recipe',
    description: clean(val(prop('description').first())) || null,
    servings: parseYield(val(prop('recipeYield').first())),
    prep_minutes: prep,
    cook_minutes: cook,
    total_minutes: parseDuration(val(prop('totalTime').first())) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null),
    image_url: prop('image').first().attr('src') ?? prop('image').first().attr('content') ?? null,
    ingredients,
    steps,
    tags: [],
    notes: null,
  };
}

export function scrapeHtml(html: string, pageUrl: string | null): ScrapeResult {
  const $ = cheerio.load(html);
  const siteName = $('meta[property="og:site_name"]').attr('content')?.trim();
  let hostName: string | null = null;
  try {
    hostName = pageUrl ? new URL(pageUrl).hostname.replace(/^www\./, '') : null;
  } catch {
    hostName = null;
  }
  const source = { source_url: pageUrl, source_name: siteName || hostName };
  const absolute = (u: string | null) => {
    if (!u || !pageUrl) return u;
    try {
      return new URL(u, pageUrl).toString();
    } catch {
      return u;
    }
  };

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const node = findRecipeNode(parseJsonLoose($(el).contents().text()));
    if (node) {
      const d = fromJsonLd(node);
      if (!source.source_name && typeof node.publisher?.name === 'string') source.source_name = node.publisher.name;
      return { method: 'json-ld', draft: { ...d, ...source, image_url: absolute(d.image_url) } };
    }
  }

  const micro = fromMicrodata($);
  if (micro && (micro.ingredients.length || micro.steps.length)) {
    return { method: 'microdata', draft: { ...micro, ...source, image_url: absolute(micro.image_url) } };
  }

  const title = $('meta[property="og:title"]').attr('content') || $('title').first().text();
  return {
    method: 'page',
    draft: {
      name: clean(title) || 'Imported recipe',
      description: clean($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content')) || null,
      servings: null,
      prep_minutes: null,
      cook_minutes: null,
      total_minutes: null,
      image_url: absolute($('meta[property="og:image"]').attr('content') ?? null),
      ingredients: [],
      steps: [],
      tags: [],
      notes: null,
      ...source,
    },
  };
}

// ---------- plain pasted text ----------

const INGREDIENT_HEADER = /^(ingredients?|you(?:'ll)? need|what you need)\s*:?$/i;
const STEP_HEADER = /^(method|instructions?|directions?|steps?|preparation|how to make( it)?)\s*:?$/i;

/** "Title\nIngredients\n...\nMethod\n..." — the shape of most copy-pasted recipes. */
export function parseRecipeText(text: string): RecipeDraft {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let name = '';
  let mode: 'head' | 'ingredients' | 'steps' = 'head';
  const head: string[] = [];
  const ingredients: RecipeDraft['ingredients'] = [];
  const steps: RecipeDraft['steps'] = [];
  const sawHeaders = lines.some((l) => INGREDIENT_HEADER.test(l)) || lines.some((l) => STEP_HEADER.test(l));
  let section: string | null = null;

  for (const line of lines) {
    if (!line) continue;
    if (INGREDIENT_HEADER.test(line)) {
      mode = 'ingredients';
      section = null;
      continue;
    }
    if (STEP_HEADER.test(line)) {
      mode = 'steps';
      section = null;
      continue;
    }
    if (!name) {
      name = line;
      continue;
    }
    // "For the sauce:" style sub-headings
    if (mode !== 'head' && /^[^.]{2,40}:$/.test(line)) {
      section = line.slice(0, -1).trim();
      continue;
    }
    if (mode === 'ingredients') ingredients.push({ section, raw: line.replace(/^[\s•\-*▢☐□]+/, '') });
    else if (mode === 'steps') steps.push({ section, text: line.replace(/^(?:step\s*)?\d+[.):]\s*/i, '') });
    else if (!sawHeaders) {
      // No headings at all: lines starting with a number or bullet look like ingredients.
      if (/^([\d½¼¾⅓⅔]|[•\-*])/.test(line) && !/^\d+[.)]\s/.test(line)) ingredients.push({ section: null, raw: line.replace(/^[•\-*]\s*/, '') });
      else steps.push({ section: null, text: line.replace(/^\d+[.)]\s*/, '') });
    } else head.push(line);
  }

  return {
    name: name || 'Pasted recipe',
    description: head.join(' ') || null,
    servings: parseYield(head.join(' ').match(/serves\s*\d+|\d+\s*servings/i)?.[0]),
    prep_minutes: null,
    cook_minutes: null,
    total_minutes: null,
    source_url: null,
    source_name: null,
    image_url: null,
    ingredients,
    steps,
    tags: [],
    notes: null,
  };
}
