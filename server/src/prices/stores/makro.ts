import { options } from '../config';
import { StoreChallengeError, storeFetch } from './http';
import { ScrapedProduct, StoreAdapter } from './types';

// makro.co.za renders search results server-side and embeds the whole page
// state as JSON in window.__INITIAL_STATE__; each product card in there has
// `titles` (brand, name, size subtitle) and `pricing`.
const BASE = 'https://www.makro.co.za';
const STATE_MARKER = 'window.__INITIAL_STATE__ = ';

export function parseMakroPage(html: string): ScrapedProduct[] {
  if (/<title>\s*Are you a human\?/i.test(html)) throw new StoreChallengeError('Makro');
  const start = html.indexOf(STATE_MARKER);
  if (start < 0) throw new Error('Makro page had no embedded product data (layout changed?)');
  const from = start + STATE_MARKER.length;
  const end = html.indexOf(';</script>', from);
  const state = JSON.parse(html.slice(from, end));

  const cards: any[] = [];
  const walk = (o: any, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 40) return;
    if (o.titles && o.pricing) {
      cards.push(o);
      return;
    }
    for (const k in o) walk(o[k], depth + 1);
  };
  walk(state.pageDataV4, 0);

  const out: ScrapedProduct[] = [];
  for (const c of cards) {
    const price = c.pricing?.finalPrice?.value;
    if (typeof price !== 'number' || !c.id) continue;
    const mrp = c.pricing?.mrp?.value;
    const image = c.media?.images?.[0]?.url as string | undefined;
    out.push({
      storeProductId: String(c.id),
      name: c.titles.title || c.titles.newTitle,
      brand: c.titles.superTitle || null,
      sizeText: c.titles.subtitle || null,
      price,
      wasPrice: typeof mrp === 'number' && mrp > price ? mrp : null,
      promo: c.pricing?.finalSavingsText || null,
      url: c.baseUrl ? BASE + String(c.baseUrl).split('&')[0] : null,
      imageUrl: image ? image.replace('{@width}', '200').replace('{@height}', '200').replace('{@quality}', '70') : null,
      inStock: c.availability?.displayState ? c.availability.displayState === 'IN_STOCK' : null,
    });
  }
  return out;
}

export const makro: StoreAdapter = {
  id: 'makro',
  name: 'Makro',
  async search(term) {
    const seen = new Map<string, ScrapedProduct>();
    for (let page = 1; page <= options.makro_pages; page++) {
      const url = `${BASE}/search?q=${encodeURIComponent(term)}${page > 1 ? `&page=${page}` : ''}`;
      const html = await (await storeFetch('makro', url)).text();
      const found = parseMakroPage(html);
      let added = 0;
      for (const p of found) {
        if (!seen.has(p.storeProductId)) {
          seen.set(p.storeProductId, p);
          added++;
        }
      }
      if (added === 0 || found.length < 40) break;
    }
    return [...seen.values()];
  },
};
