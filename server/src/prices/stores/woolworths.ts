import { options } from '../config';
import { storeFetch } from './http';
import { ScrapedProduct, StoreAdapter } from './types';

// woolworths.co.za's search box is served by Constructor.io; the page calls
// it straight from the browser with the site's public client key, and so do
// we. Prices come per region as p10 / p30 / p60.
const ENDPOINT = 'https://wpkmgeuco-zone.cnstrc.com/v1/search/';
const CLIENT_KEY = 'key_tw9hKe0fkfgEf36D';
const PER_PAGE = 60;
const MAX_PAGES = 2;

export function parseWoolworths(body: any): ScrapedProduct[] {
  const zone = options.woolworths_price_zone;
  const out: ScrapedProduct[] = [];
  for (const r of body?.response?.results ?? []) {
    const d = r.data ?? {};
    const price = d[zone] ?? d.p10;
    if (typeof price !== 'number' || price <= 0 || !d.id) continue;
    const promos: string[] = Array.isArray(d.promo) ? d.promo : [];
    out.push({
      storeProductId: String(d.id),
      name: d.description || r.value,
      brand: d.brand && d.brand !== 'Woolies Brands' ? d.brand : 'Woolworths',
      price,
      promo: promos.length ? promos.join(' · ') : null,
      url: d.url ? `https://www.woolworths.co.za/${d.url}` : null,
      imageUrl: d.image_url || null,
    });
  }
  return out;
}

export const woolworths: StoreAdapter = {
  id: 'woolworths',
  name: 'Woolworths',
  async search(term) {
    const out: ScrapedProduct[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url =
        `${ENDPOINT}${encodeURIComponent(term)}?key=${CLIENT_KEY}` +
        `&num_results_per_page=${PER_PAGE}&page=${page}&filters%5Bvisibility%5D=all`;
      const body: any = await (await storeFetch('woolworths', url, { headers: { Accept: 'application/json' } })).json();
      out.push(...parseWoolworths(body));
      if ((body?.response?.total_num_results ?? 0) <= page * PER_PAGE) break;
    }
    return out;
  },
};
