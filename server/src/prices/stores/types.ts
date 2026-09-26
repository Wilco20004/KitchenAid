export interface ScrapedProduct {
  storeProductId: string;
  name: string;
  brand?: string | null;
  sizeText?: string | null; // when the store gives the size apart from the name
  price: number;
  wasPrice?: number | null;
  promo?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  inStock?: boolean | null;
  pricedPerKg?: boolean;
}

export interface StoreAdapter {
  id: string;
  name: string;
  search(term: string): Promise<ScrapedProduct[]>;
  /** false when not configured (e.g. no API key) — left out everywhere. */
  enabled?: () => boolean;
  /**
   * 'catalog': never searched when you search. A background job fetches a few
   * broad terms a day, and searches match those stored products locally.
   */
  mode?: 'live' | 'catalog';
  /** How long stored products stay usable for a catalog store (days). */
  keepDays?: () => number;
  /** false = not refreshed by the background watchlist (costs credits). */
  background?: boolean;
}
