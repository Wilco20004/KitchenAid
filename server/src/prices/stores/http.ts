// Every store request goes through here: one honest User-Agent, a timeout,
// and at least MIN_GAP_MS between requests to the same store so a burst of
// searches never hammers anyone.
export const USER_AGENT = 'KitchenAid/0.2 (personal grocery price comparison; home use)';

const MIN_GAP_MS = 2000;
const TIMEOUT_MS = 20000;
const nextSlot = new Map<string, number>();

async function waitTurn(store: string) {
  const at = Math.max(Date.now(), nextSlot.get(store) ?? 0);
  nextSlot.set(store, at + MIN_GAP_MS);
  const wait = at - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export class StoreHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// The store served a "prove you're human" page. PriceScout never tries to
// get past one: the search is marked failed and the store is left alone for
// a long while (see search.ts), with the last good result still shown.
export class StoreChallengeError extends Error {
  constructor(store: string) {
    super(`${store} asked for a human check; skipped for now`);
  }
}

export async function storeFetch(store: string, url: string, init: RequestInit = {}): Promise<Response> {
  await waitTurn(store);
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-ZA,en;q=0.9', ...(init.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // 403/429 mean the store doesn't want us right now: report it and let
    // the cache serve the last good result rather than retrying.
    throw new StoreHttpError(res.status, `${store} answered HTTP ${res.status}`);
  }
  return res;
}
