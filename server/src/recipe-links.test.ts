import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeRef, parseTemplate, renameRef, renderStep } from './steps';
import { parseIngredient, parseQuantity } from './ingredients';

// A throwaway database: set before the modules below open it.
process.env.KITCHENAID_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchenaid-test-'));

test('parser: nested brackets from recipe sites become a tidy note', () => {
  assert.deepEqual(parseIngredient('1 3/4 cups plain flour (all-purpose flour) ((Note 1))'), {
    quantity: 1.75,
    quantity_max: null,
    unit: 'cup',
    name: 'plain flour',
    note: 'all-purpose flour, Note 1',
  });
  const cocoa = parseIngredient('1/2 cup Dutch process cocoa powder (, sifted (Note 3))');
  assert.equal(cocoa.name, 'Dutch process cocoa powder');
  assert.equal(cocoa.note, 'sifted, Note 3');
  assert.equal(parseIngredient('1 large egg ((55-60g / 2oz) (fridge-cold fine, Note 6))').note, '55-60g / 2oz, fridge-cold fine, Note 6');
  assert.deepEqual(parseQuantity('1 ¾'), { quantity: 1.75, quantity_max: null });
  assert.deepEqual(parseQuantity('2-3'), { quantity: 2, quantity_max: 3 });
  assert.deepEqual(parseQuantity('some'), { quantity: null, quantity_max: null });
});

const MUFFINS = [
  { ref: 'flour', name: 'plain flour', quantity: 1.75, quantity_max: null, unit: 'cup' },
  { ref: 'chips', name: 'dark chocolate chips', quantity: 1.5, quantity_max: null, unit: 'cup' },
  { ref: 'salt', name: 'salt', quantity: 0.5, quantity_max: null, unit: 'tsp' },
  { ref: 'egg', name: 'egg', quantity: 1, quantity_max: 2, unit: null },
];

test('steps: {{refs}} fill in amounts, scaled and in part', () => {
  assert.equal(renderStep('Sift {{flour}} and {{ salt }}.', MUFFINS), 'Sift 1¾ cup plain flour and ½ tsp salt.');
  assert.equal(renderStep('Sift {{ingredient.flour.total}}.', MUFFINS), 'Sift 1¾ cup plain flour.');
  assert.equal(renderStep('Add {{flour.amount}} of {{flour.name}}', MUFFINS), 'Add 1¾ cup of plain flour');
  // A double batch.
  assert.equal(renderStep('Sift {{flour}}', MUFFINS, 2), 'Sift 3½ cup plain flour');
  // Half a batch: eighths, not 0.9.
  assert.equal(renderStep('Sift {{flour}}', MUFFINS, 0.5), 'Sift ⅞ cup plain flour');
  assert.equal(renderStep('Reserve {{chips*1/6}} for the top', MUFFINS), 'Reserve ¼ cup dark chocolate chips for the top');
  assert.equal(renderStep('Reserve {{chips.amount*1/6}}', MUFFINS), 'Reserve ¼ cup');
  assert.equal(renderStep('Reserve {{chips*0.5.amount}}', MUFFINS), 'Reserve ¾ cup');
  assert.equal(renderStep('Beat {{egg}}', MUFFINS, 2), 'Beat 2–4 egg');
  // Unknown refs and other braces are left alone.
  assert.equal(renderStep('Add {{sugar}} {not this}', MUFFINS), 'Add {{sugar}} {not this}');
  assert.equal(parseTemplate('chips*0'), null);
});

test('steps: the same item twice in a recipe gives the total', () => {
  const twice = [
    { ref: 'sugar', name: 'sugar', quantity: 1, quantity_max: null, unit: 'cup' },
    { ref: 'sugar', name: 'sugar', quantity: 0.5, quantity_max: null, unit: 'cup' },
  ];
  assert.equal(renderStep('{{sugar}}', twice), '1½ cup sugar');
  assert.equal(renderStep('{{sugar*1/3.amount}}', twice), '½ cup');
});

test('steps: renaming a short name rewrites the steps that use it', () => {
  assert.equal(renameRef('Sift {{flour}}, {{flour.amount*1/2}} and {{ingredient.flour.total}}; {{flours}}', 'flour', 'cake-flour'),
    'Sift {{cake-flour}}, {{cake-flour.amount*1/2}} and {{ingredient.cake-flour.total}}; {{flours}}');
});

test('short names: last word, then two words, then a number', () => {
  const taken = new Set<string>();
  const take = (n: string) => {
    const r = makeRef(n, taken);
    taken.add(r);
    return r;
  };
  assert.equal(take('plain flour'), 'flour');
  assert.equal(take('self-raising flour'), 'self-raising-flour');
  assert.equal(take('baking soda / bi-carb'), 'soda');
  assert.equal(take('Dutch process cocoa powder'), 'cocoa');
  assert.equal(take('vanilla extract'), 'vanilla');
  assert.equal(take('Large Eggs'), 'eggs');
  assert.equal(take('flour'), 'flour2');
});

test('linked ingredients: costing, cooking and shopping use the link, not the name', async () => {
  const items = await import('./items');
  const { saveRecipe, loadRecipe, setIngredientLinks } = await import('./recipes');
  const { cookPlan } = await import('./cooking');
  const { recipeCost } = await import('./costing');
  const { previewIngredients } = await import('./shopping');

  const cake = items.addToPantry({ name: 'Cake Flour', quantity: 2.5, unit: 'kg' });
  items.setPackPrice(cake.id, 30, '2.5kg', 'manual');
  const id = saveRecipe(
    {
      name: 'Muffins',
      servings: 12,
      ingredients: [
        { section: null, raw: '1 3/4 cups plain flour (all-purpose flour) ((Note 1))' },
        { section: null, raw: '1 cup water' },
      ],
      steps: [{ section: null, text: 'Sift {{flour}}.' }],
    },
    null
  );
  let r = loadRecipe(id)!;
  const [flour, water] = r.ingredients;
  // Not linked: no short name for steps yet.
  assert.equal(flour.ref, null);
  assert.equal(flour.note, 'all-purpose flour, Note 1');
  // "plain flour" isn't "Cake Flour" by name, so nothing is taken or costed yet…
  assert.equal(flour.item, null);
  assert.equal(cookPlan(id).lines.length, 0);
  // …but it is offered as the link.
  assert.equal(flour.suggested?.name, 'Cake Flour');

  setIngredientLinks(id, [
    { id: flour.id, item_id: cake.id },
    { id: water.id, no_link: true },
  ]);
  r = loadRecipe(id)!;
  assert.equal(r.ingredients[0].item?.name, 'Cake Flour');
  // Linked: the item's short name, made up from its name.
  assert.equal(r.ingredients[0].ref, 'flour');
  assert.equal(items.getItem(cake.id)?.ref, 'flour');
  assert.equal(r.ingredients[1].no_link, true);
  assert.equal(r.ingredients[1].suggested, null);

  const plan = cookPlan(id);
  assert.deepEqual(plan.lines.map((l) => l.item), ['Cake Flour']);
  const cost = await recipeCost(id);
  assert.equal(cost.lines[0].item, 'Cake Flour');
  assert.ok(cost.lines[0].cost! > 0);
  const shop = previewIngredients([{ recipe_id: id, servings: null }]);
  assert.equal(shop[0].name, 'Cake Flour');
  assert.equal(shop[0].in_pantry, true);

  // Saving the recipe again as plain lines (an older client) keeps the links and short names.
  saveRecipe({ name: 'Muffins', ingredients: r.ingredients.map((i) => ({ section: null, raw: i.raw })) }, id);
  r = loadRecipe(id)!;
  assert.equal(r.ingredients[0].item?.name, 'Cake Flour');
  assert.equal(r.ingredients[0].ref, 'flour');
  assert.equal(r.ingredients[1].no_link, true);

  // Edited as fields: amount text, note, a new short name and a new item by name.
  saveRecipe(
    {
      name: 'Muffins',
      ingredients: [
        { section: null, amount: '2 ½', unit: 'Cups', name: 'plain flour', note: 'sifted', item_name: 'Flour' },
        { section: null, name: 'water', amount: '', unit: '', no_link: true },
      ],
    },
    id
  );
  r = loadRecipe(id)!;
  assert.equal(r.ingredients[0].raw, '2½ cup plain flour, sifted');
  assert.equal(r.ingredients[0].quantity, 2.5);
  // "flour" is Cake Flour's, so the new Flour item gets the next best name.
  assert.equal(r.ingredients[0].ref, 'flour2');
  assert.equal(r.ingredients[0].item?.name, 'Flour');
  assert.equal(r.ingredients[1].quantity, null);

  // Merging the item moves the link, and steps switch to the kept item's short name.
  saveRecipe({ name: 'Muffins', steps: [{ section: null, text: 'Sift {{flour2.amount}} of flour.' }] }, id);
  const flourItem = items.findItem({ name: 'Flour' })!;
  items.mergeItems(flourItem.id, cake.id);
  assert.equal(loadRecipe(id)!.ingredients[0].item?.name, 'Cake Flour');
  assert.equal(loadRecipe(id)!.steps[0].text, 'Sift {{flour.amount}} of flour.');

  // Renaming the short name on the item rewrites the recipe's steps; another item's name is refused.
  items.setItemRef(cake.id, 'Cake Flour');
  assert.equal(loadRecipe(id)!.steps[0].text, 'Sift {{cake-flour.amount}} of flour.');
  assert.equal(loadRecipe(id)!.ingredients[0].ref, 'cake-flour');
  const other = items.ensureItem('Rice');
  items.ensureItemRef(other.id);
  assert.throws(() => items.setItemRef(other.id, 'cake-flour'), /already uses/);
  items.deleteItem(cake.id);
  assert.equal(loadRecipe(id)!.ingredients[0].item, null);
});

test('repair: old ingredient lines are re-read; items get short names', async () => {
  const { db } = await import('./db');
  const { saveRecipe, loadRecipe } = await import('./recipes');
  const { repairIngredients } = await import('./repair');
  const id = saveRecipe({ name: 'Old', ingredients: [{ section: null, raw: '1 cup sugar (, packed (Note 5))' }] }, null);
  // As an older version stored it.
  db.prepare("UPDATE recipe_ingredients SET name = 'sugar )', note = '(, packed (Note 5)' WHERE recipe_id = ?").run(id);
  const items = await import('./items');
  const sugar = items.ensureItem('Castor Sugar');
  const r = repairIngredients();
  assert.ok(r.reparsed >= 1 && r.refs >= 1);
  const ing = loadRecipe(id)!.ingredients[0];
  assert.equal(ing.name, 'sugar');
  assert.equal(ing.note, 'packed, Note 5');
  assert.equal(items.getItem(sugar.id)?.ref, 'sugar');
});

test('suggested links: describing words and synonyms only, never a different product', async () => {
  const items = await import('./items');
  const { suggestItemFor } = await import('./recipes');
  for (const n of ['Cake Flour', 'Baking Powder', 'Baking Soda', 'Olive oil', 'White Sugar', 'Cream', 'Eggs', 'Full Cream Milk', 'Cheese']) items.ensureItem(n);
  const s = (n: string) => suggestItemFor(n)?.name ?? null;
  assert.equal(s('plain flour'), 'Cake Flour');
  assert.equal(s('baking soda / bi-carb'), 'Baking Soda');
  assert.equal(s('bicarbonate of soda'), 'Baking Soda');
  assert.equal(s('large eggs'), 'Eggs');
  assert.equal(s('milk'), 'Full Cream Milk');
  assert.equal(s('Dutch process cocoa powder'), null);
  assert.equal(s('instant coffee granules / powder'), null);
  assert.equal(s('canola oil'), null);
  assert.equal(s('brown sugar'), null);
  assert.equal(s('sour cream'), null);
  assert.equal(s('cream cheese'), null);
});
