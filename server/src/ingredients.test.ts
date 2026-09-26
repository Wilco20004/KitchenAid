import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAmounts, formatAmount, nameKey, parseIngredient } from './ingredients';

const p = parseIngredient;

test('quantities: whole, decimal, fractions, unicode, mixed, ranges', () => {
  assert.equal(p('2 onions').quantity, 2);
  assert.equal(p('1.5 kg potatoes').quantity, 1.5);
  assert.equal(p('1,5 kg potatoes').quantity, 1.5);
  assert.equal(p('1/2 cup milk').quantity, 0.5);
  assert.equal(p('½ cup milk').quantity, 0.5);
  assert.equal(p('1½ cups milk').quantity, 1.5);
  assert.equal(p('1 1/2 cups milk').quantity, 1.5);
  const range = p('2-3 cloves garlic');
  assert.deepEqual([range.quantity, range.quantity_max, range.unit, range.name], [2, 3, 'clove', 'garlic']);
  assert.equal(p('2 to 3 tbsp oil').quantity_max, 3);
  assert.deepEqual([p('1 dozen eggs').quantity, p('1 dozen eggs').unit, p('1 dozen eggs').name], [12, null, 'eggs']);
});

test('units: spelled out, abbreviated, attached, case-sensitive T/t', () => {
  assert.equal(p('2 tablespoons butter').unit, 'tbsp');
  assert.equal(p('2 Tbsp. butter').unit, 'tbsp');
  assert.equal(p('1 T sugar').unit, 'tbsp');
  assert.equal(p('1 t salt').unit, 'tsp');
  assert.equal(p('400g chopped tomatoes').unit, 'g');
  assert.equal(p('400g chopped tomatoes').name, 'chopped tomatoes');
  assert.equal(p('250 ml cream').unit, 'ml');
  assert.equal(p('1 lb ground beef').unit, 'lb');
});

test('a unit-looking word at the start of a name is not a unit', () => {
  const garlic = p('3 garlic cloves');
  assert.equal(garlic.unit, null);
  assert.equal(garlic.name, 'garlic cloves');
  assert.equal(p('2 cans tomatoes').unit, 'can');
  assert.equal(p('1 large onion').unit, null);
});

test('notes: parentheticals and after the first comma', () => {
  const r = p('1 cup (120g) plain flour, sifted');
  assert.equal(r.name, 'plain flour');
  assert.equal(r.note, '(120g), sifted');
  assert.equal(r.unit, 'cup');
  assert.equal(p('2 x 400g tins chickpeas, drained').quantity, 2);
});

test('lines without quantities keep everything in the name', () => {
  assert.deepEqual(p('Salt and pepper to taste'), { quantity: null, quantity_max: null, unit: null, name: 'Salt and pepper to taste', note: null });
  const pinch = p('pinch of salt');
  assert.equal(pinch.unit, 'pinch');
  assert.equal(pinch.name, 'salt');
  assert.equal(p('▢ 2 eggs').quantity, 2);
});

test('nameKey merges plurals and size words', () => {
  assert.equal(nameKey('2 Large Onions'.replace(/^\d+\s*/, '')), 'onion');
  assert.equal(nameKey('Tomatoes'), 'tomato');
  assert.equal(nameKey('berries'), 'berry');
  assert.equal(nameKey('fresh basil leaves'), 'basil leave');
  assert.equal(nameKey('Hummus'), 'hummus');
});

test('adding amounts', () => {
  assert.deepEqual(addAmounts({ quantity: 2, unit: 'cup' }, { quantity: 1, unit: 'cup' }), { quantity: 3, unit: 'cup' });
  assert.deepEqual(addAmounts({ quantity: 500, unit: 'g' }, { quantity: 1, unit: 'kg' }), { quantity: 1.5, unit: 'kg' });
  assert.deepEqual(addAmounts({ quantity: 2, unit: 'tbsp' }, { quantity: 1, unit: 'tsp' }), { quantity: 35, unit: 'ml' });
  assert.equal(addAmounts({ quantity: 2, unit: 'cup' }, { quantity: 100, unit: 'g' }), null);
  assert.deepEqual(addAmounts({ quantity: null, unit: null }, { quantity: 2, unit: null }), { quantity: 2, unit: null });
});

test('formatting', () => {
  assert.equal(formatAmount({ quantity: 1.5, unit: 'cup' }), '1½ cup');
  assert.equal(formatAmount({ quantity: 0.333, unit: 'tsp' }), '⅓ tsp');
  assert.equal(formatAmount({ quantity: 2.5, unit: 'g' }), '2.5 g');
  assert.equal(formatAmount({ quantity: 4.9999, unit: 'g' }), '5 g');
  assert.equal(formatAmount({ quantity: 1.25, unit: 'kg' }), '1.25 kg');
  assert.equal(formatAmount({ quantity: 3, unit: null }), '3');
});
