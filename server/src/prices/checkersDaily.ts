import { db } from '../db';
import { nameKey, SIZE_WORDS } from '../ingredients';
import { getSetting, setSetting } from '../settings';
import { options } from './config';
import { catalogMatches, fetchTerm, termKey } from './search';
import { checkers, checkersBudgetLeft } from './stores/checkers';
import { searchTerm } from './basket';

// Keeps a local Checkers catalogue fresh on a fixed Parse budget: a few broad
// searches a day ("milk", "rice", "tomato sauce"), each pulling a big page of
// products. Your own searches then match that catalogue for free.

// Names whose last word alone is too vague to search: "tomato sauce" not "sauce".
const GENERIC_TAIL = new Set([
  'sauce', 'powder', 'oil', 'soup', 'meal', 'paste', 'cheese', 'juice', 'milk', 'cream', 'flour', 'sugar', 'stock', 'mix',
  'spread', 'bread', 'rice', 'beans', 'bean', 'water', 'butter', 'vinegar', 'salt', 'pepper', 'leaves', 'seeds',
]);
const STOP = new Set(['and', 'of', 'the', 'for', 'with', 'or', 'a']);

/** "Clover Full Cream Milk" → "milk"; "Knorr Brown Onion Soup" → "onion soup"; "Eggs" → "eggs". */
export function broadTerm(name: string): string | null {
  const words = searchTerm(name)
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !SIZE_WORDS.has(w) && !/\d/.test(w));
  if (!words.length) return null;
  const last = words[words.length - 1];
  // Vague on its own and qualified by the word before it: keep both.
  if (words.length >= 2 && GENERIC_TAIL.has(last) && !['milk', 'rice', 'bread', 'butter', 'sugar', 'flour', 'salt', 'water'].includes(last)) {
    return `${words[words.length - 2]} ${last}`;
  }
  return last;
}

/** What's worth knowing Checkers prices for, most useful first. */
export function candidateTerms(): string[] {
  const names = (sql: string, ...params: unknown[]) => (db.prepare(sql).all(...params) as { name: string }[]).map((r) => r.name);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

  // Most useful first: what's on the lists now, searches you watch, recipes
  // planned for the next 10 days, then what you buy most.
  const onLists = names('SELECT name FROM shopping_items WHERE checked = 0 ORDER BY created_at');
  const watched = (db.prepare('SELECT term FROM price_watchlist').all() as { term: string }[]).map((r) => r.term.toLowerCase());
  const planned = names(
    `SELECT i.name FROM meal_plan m JOIN recipe_ingredients i ON i.recipe_id = m.recipe_id
     WHERE m.date BETWEEN ? AND ? AND i.quantity IS NOT NULL`,
    today,
    soon
  );
  const favourites = names('SELECT name FROM items ORDER BY use_count DESC, in_pantry DESC LIMIT 60');

  const staples = new Set((db.prepare('SELECT name_key FROM staples').all() as { name_key: string }[]).map((r) => r.name_key));
  const out: string[] = [];
  const add = (t: string | null) => {
    if (t && !out.includes(t) && !staples.has(nameKey(t))) out.push(t);
  };
  onLists.forEach((n) => add(broadTerm(n)));
  watched.forEach(add);
  planned.forEach((n) => add(broadTerm(n)));
  favourites.forEach((n) => add(broadTerm(n)));
  return out;
}

export interface DailyRun {
  at: string;
  searched: { term: string; products: number; error: string | null }[];
  skipped_covered: number;
  budget_left: number;
}

let running: Promise<DailyRun> | null = null;

export function runCheckersDaily(): Promise<DailyRun> {
  running ??= doRun().finally(() => (running = null));
  return running;
}

async function doRun(): Promise<DailyRun> {
  const run: DailyRun = { at: new Date().toISOString(), searched: [], skipped_covered: 0, budget_left: checkersBudgetLeft() };
  if (!checkers.enabled?.()) return run;
  const recentCutoff = Date.now() - options.checkers_refresh_days * 86400000;
  const lastFetched = db.prepare("SELECT fetched_at FROM price_searches WHERE store = 'checkers' AND term_key = ?");

  for (const term of candidateTerms()) {
    if (checkersBudgetLeft() <= 0) break;
    const row = lastFetched.get(termKey(term)) as { fetched_at: string | null } | undefined;
    if (row?.fetched_at && new Date(row.fetched_at).getTime() > recentCutoff) continue;
    // Already well covered by earlier broad searches? Save the credit.
    if (catalogMatches(checkers, term).length >= 5) {
      run.skipped_covered++;
      continue;
    }
    const error = await fetchTerm(checkers, term);
    run.searched.push({ term, products: catalogMatches(checkers, term).length, error });
    if (error) break; // a refusal or budget error: stop for today
  }
  run.budget_left = checkersBudgetLeft();
  setSetting('checkers_last_run', JSON.stringify(run));
  return run;
}

export function lastCheckersRun(): DailyRun | null {
  const raw = getSetting('checkers_last_run');
  return raw ? (JSON.parse(raw) as DailyRun) : null;
}

/** Hourly check; spends the day's budget from 05:00 (South African time) onwards. */
export function startCheckersDaily() {
  const tick = () => {
    if (!checkers.enabled?.() || checkersBudgetLeft() <= 0) return;
    const hour = Number(new Intl.DateTimeFormat('en-ZA', { hour: 'numeric', hour12: false, timeZone: 'Africa/Johannesburg' }).format(new Date()));
    if (hour < 5) return;
    runCheckersDaily().catch((e) => console.warn(`[checkers] ${e.message}`));
  };
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, 60 * 60 * 1000);
}
