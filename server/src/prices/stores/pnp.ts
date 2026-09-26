import { options } from '../config';
import { storeFetch } from './http';
import { ScrapedProduct, StoreAdapter } from './types';

// pnp.co.za is an SAP Commerce (Hybris) SPA; its search box POSTs to the
// products/search endpoint below. Prices are per store (storeCode).
const BASE = 'https://www.pnp.co.za';
const FIELDS =
  'products(code,name,url,price(FULL),potentialPromotions(FULL),images(DEFAULT),inStockIndicator),pagination(DEFAULT)';
const PAGE_SIZE = 72;
const MAX_PAGES = 2;

export function parsePnp(body: any): ScrapedProduct[] {
  const out: ScrapedProduct[] = [];
  for (const p of body?.products ?? []) {
    const price = p.price?.value;
    if (typeof price !== 'number' || price <= 0 || !p.code) continue;
    const promos = (p.potentialPromotions ?? []).map((x: any) => x.promotionTextMessage).filter(Boolean);
    const image = (p.images ?? []).find((i: any) => i.format === 'product') ?? p.images?.[0];
    out.push({
      storeProductId: String(p.code),
      name: p.name,
      price,
      wasPrice: p.price.oldPrice > price ? p.price.oldPrice : null,
      promo: promos.length ? promos.join(' · ') : null,
      url: p.url ? BASE + p.url : null,
      imageUrl: image?.url ?? null,
      inStock: typeof p.inStockIndicator === 'boolean' ? p.inStockIndicator : null,
      // Codes end in _EA (each) or _KG (sold by weight, price is per kg).
      pricedPerKg: String(p.code).endsWith('_KG'),
    });
  }
  return out;
}

export const pnp: StoreAdapter = {
  id: 'pnp',
  name: 'Pick n Pay',
  async search(term) {
    const out: ScrapedProduct[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${BASE}/pnphybris/v2/pnp-spa/products/search?fields=${encodeURIComponent(FIELDS)}` +
        `&query=${encodeURIComponent(term)}&pageSize=${PAGE_SIZE}&currentPage=${page}` +
        `&storeCode=${encodeURIComponent(options.pnp_store_code)}&lang=en&curr=ZAR`;
      const res = await storeFetch('pnp', url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body: any = await res.json();
      out.push(...parsePnp(body));
      if (page + 1 >= (body?.pagination?.totalPages ?? 1)) break;
    }
    return out;
  },
};
