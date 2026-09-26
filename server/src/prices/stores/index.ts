import { checkers } from './checkers';
import { makro } from './makro';
import { pnp } from './pnp';
import { StoreAdapter } from './types';
import { woolworths } from './woolworths';

// Checkers is only here through Parse (see checkers.ts) and only when a Parse
// API key is configured. Shoprite blocks automated requests; SPAR has no
// online prices (each store sets its own) — both come from your slips.
export const STORES: StoreAdapter[] = [pnp, checkers, makro, woolworths];

/** The stores that are switched on right now. */
export function activeStores(): StoreAdapter[] {
  return STORES.filter((s) => s.enabled?.() !== false);
}

export function storeById(id: string): StoreAdapter | undefined {
  return STORES.find((s) => s.id === id);
}
