import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackSize, unitPrices } from './prices/units';

function prices(text: string, price: number) {
  return unitPrices(price, parsePackSize(text));
}

test('single can by weight', () => {
  assert.deepEqual(parsePackSize('Rhodes Tomatoes Chopped & Peeled 410g'), { count: 1, each: 410, unit: 'g', perKg: false });
  assert.deepEqual(prices('410 g', 20.5), { perItem: 20.5, perMeasure: 50, measureLabel: 'kg' });
});

test('makro "Pack of" subtitle', () => {
  assert.deepEqual(parsePackSize('410 g, Pack of 6'), { count: 6, each: 410, unit: 'g', perKg: false });
  assert.equal(prices('410 g, Pack of 6', 72.95).perItem, 12.16);
});

test('N x size', () => {
  assert.deepEqual(parsePackSize('All Gold Tomato Puree 12 x 410 g'), { count: 12, each: 410, unit: 'g', perKg: false });
  assert.deepEqual(parsePackSize('6 x 3 kg'), { count: 6, each: 3000, unit: 'g', perKg: false });
  assert.deepEqual(parsePackSize('Parmalat Dairy Snack 6 x 100g'), { count: 6, each: 100, unit: 'g', perKg: false });
});

test('volumes', () => {
  assert.deepEqual(prices('Clover Full Cream Milk 2L', 40), { perItem: 40, perMeasure: 20, measureLabel: 'L' });
  assert.deepEqual(parsePackSize('Coke 6 x 330ml'), { count: 6, each: 330, unit: 'ml', perKg: false });
  assert.deepEqual(parsePackSize('Sunflower Oil 1,5 l'), { count: 1, each: 1500, unit: 'ml', perKg: false });
});

test('decimal kg', () => {
  assert.deepEqual(prices('PnP Bananas Box 1.2kg', 42.99), { perItem: 42.99, perMeasure: 35.83, measureLabel: 'kg' });
});

test('loose produce priced per kg', () => {
  assert.deepEqual(prices('Bananas Loose per kg', 29.99), { perItem: null, perMeasure: 29.99, measureLabel: 'kg' });
});

test('toilet paper counts', () => {
  assert.deepEqual(parsePackSize('Twinsaver 2 Ply Toilet Paper 9 Rolls'), { count: 9, each: null, unit: null, perKg: false });
  assert.deepEqual(prices('Baby Soft 2-Ply 18s', 180), { perItem: 10, perMeasure: null, measureLabel: null });
  assert.deepEqual(prices("Toilet Rolls 4's 350 sheets", 40), { perItem: 10, perMeasure: 2.86, measureLabel: '100 sheets' });
});

test('makro "Pack of N x M Rolls"', () => {
  assert.equal(parsePackSize('M 2 Ply Toilet Paper Roll Pack of 1 x 24 Rolls').count, 24);
  assert.equal(parsePackSize('Pack of 2 x 24 Rolls').count, 48);
  assert.equal(prices('Pack of 12 x 4 Rolls', 169.95).perItem, 3.54);
  assert.equal(parsePackSize('Pack of 72 x 72 Rolls').count, 72);
});

test('no size at all', () => {
  assert.deepEqual(prices('PnP Bananas Packet', 42.99), { perItem: 42.99, perMeasure: null, measureLabel: null });
});

test('2-ply is not a count', () => {
  assert.equal(parsePackSize('Softex 2 Ply Toilet Tissue 10 Rolls').count, 10);
});

test('pnp count spellings', () => {
  assert.equal(parsePackSize('Twinsaver 2ply White Toilet Paper 24 Pac').count, 24);
  assert.equal(parsePackSize('Twinsaver 2 Ply White Luxury Toilet Paper 4ea').count, 4);
  assert.equal(parsePackSize('No Name 2-Ply Toilet Paper 9 Pack').count, 9);
  assert.deepEqual(prices('No Name 2 Ply 350 Sheets Toilet Paper 4 Pack', 44.99), {
    perItem: 11.25,
    perMeasure: 3.21,
    measureLabel: '100 sheets',
  });
});
