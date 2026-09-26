import { makro } from './makro';
import { pnp } from './pnp';
import { StoreAdapter } from './types';
import { woolworths } from './woolworths';

// Checkers/Shoprite (Sixty60) aren't here: plain requests get HTTP 403 and
// the site shows no products until a delivery address is entered.
export const STORES: StoreAdapter[] = [pnp, makro, woolworths];

export function storeById(id: string): StoreAdapter | undefined {
  return STORES.find((s) => s.id === id);
}
