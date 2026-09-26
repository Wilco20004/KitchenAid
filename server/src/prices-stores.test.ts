import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreChallengeError } from './prices/stores/http';
import { parseMakroPage } from './prices/stores/makro';
import { parsePnp } from './prices/stores/pnp';
import { parseWoolworths } from './prices/stores/woolworths';

test('makro: reads product cards from the embedded page state', () => {
  const state = {
    pageDataV4: {
      page: {
        data: {
          slot: [
            {
              widget: {
                data: {
                  products: [
                    {
                      productInfo: {
                        value: {
                          id: 'ABC123',
                          baseUrl: '/koo-beans/p/itm1?pid=ABC123&lid=x',
                          titles: { title: 'KOO Baked Beans', superTitle: 'KOO', subtitle: '410 g, Pack of 6' },
                          pricing: { finalPrice: { value: 89.95 }, mrp: { value: 99.95 } },
                          media: { images: [{ url: 'https://img/{@width}/{@height}/a.jpg?q={@quality}' }] },
                          availability: { displayState: 'IN_STOCK' },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };
  const html = `<html><script>window.__INITIAL_STATE__ = ${JSON.stringify(state)};</script></html>`;
  assert.deepEqual(parseMakroPage(html), [
    {
      storeProductId: 'ABC123',
      name: 'KOO Baked Beans',
      brand: 'KOO',
      sizeText: '410 g, Pack of 6',
      price: 89.95,
      wasPrice: 99.95,
      promo: null,
      url: 'https://www.makro.co.za/koo-beans/p/itm1?pid=ABC123',
      imageUrl: 'https://img/200/200/a.jpg?q=70',
      inStock: true,
    },
  ]);
});

test('makro: a human-check page is reported, never parsed around', () => {
  assert.throws(() => parseMakroPage('<html><head><title>Are you a human?</title></head></html>'), StoreChallengeError);
});

test('pnp: per-kg items and promotions', () => {
  const out = parsePnp({
    products: [
      {
        code: '000000000000111_KG',
        name: 'Loose Bananas',
        url: '/bananas/p/000000000000111_KG',
        price: { value: 24.99, oldPrice: 0 },
        potentialPromotions: [{ promotionTextMessage: 'Smart Price' }],
        images: [{ format: 'product', url: 'https://img/p.jpg' }],
        inStockIndicator: true,
      },
    ],
  });
  assert.equal(out[0].pricedPerKg, true);
  assert.equal(out[0].promo, 'Smart Price');
  assert.equal(out[0].wasPrice, null);
  assert.equal(out[0].url, 'https://www.pnp.co.za/bananas/p/000000000000111_KG');
});

test('woolworths: price zone and house brand', () => {
  const out = parseWoolworths({
    response: {
      results: [
        { value: 'Diced Tomatoes 400 g', data: { id: '1', p10: 28.99, brand: 'Woolies Brands', url: 'prod/x/_/A-1', promo: ['Buy 5 for R105'] } },
        { value: 'No price', data: { id: '2' } },
      ],
    },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].brand, 'Woolworths');
  assert.equal(out[0].price, 28.99);
  assert.equal(out[0].promo, 'Buy 5 for R105');
});
