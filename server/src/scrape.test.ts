import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToSteps, parseDuration, parseRecipeText, scrapeHtml } from './import/scrape';

const jsonLdPage = (data: unknown) =>
  `<html><head><meta property="og:site_name" content="Test Kitchen"><script type="application/ld+json">${JSON.stringify(data)}</script></head><body></body></html>`;

test('JSON-LD inside @graph with sections, HowToSteps and image objects', () => {
  const html = jsonLdPage({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', name: 'ignored' },
      {
        '@type': ['Recipe', 'NewsArticle'],
        name: 'Bobotie &amp; Yellow Rice',
        description: '<p>A Cape Malay classic.</p>',
        recipeYield: ['6', '6 servings'],
        prepTime: 'PT20M',
        cookTime: 'PT1H',
        image: [
          { '@type': 'ImageObject', url: 'https://x.test/small.jpg', width: 300 },
          { '@type': 'ImageObject', url: 'https://x.test/big.jpg', width: 1200 },
        ],
        recipeIngredient: ['1 kg beef mince', '2 slices white bread', '2 eggs'],
        recipeCategory: 'Dinner',
        recipeCuisine: ['South African'],
        keywords: 'bobotie, mince, easy recipe',
        recipeInstructions: [
          {
            '@type': 'HowToSection',
            name: 'Filling',
            itemListElement: [
              { '@type': 'HowToStep', text: 'Fry the onion.' },
              { '@type': 'HowToStep', text: 'Add the mince.' },
            ],
          },
          { '@type': 'HowToSection', name: 'Topping', itemListElement: [{ '@type': 'HowToStep', text: 'Whisk eggs &amp; milk.' }] },
        ],
      },
    ],
  });
  const { draft, method } = scrapeHtml(html, 'https://www.example.com/bobotie');
  assert.equal(method, 'json-ld');
  assert.equal(draft.name, 'Bobotie & Yellow Rice');
  assert.equal(draft.description, 'A Cape Malay classic.');
  assert.equal(draft.servings, 6);
  assert.equal(draft.prep_minutes, 20);
  assert.equal(draft.cook_minutes, 60);
  assert.equal(draft.total_minutes, 80);
  assert.equal(draft.image_url, 'https://x.test/big.jpg');
  assert.equal(draft.source_name, 'Test Kitchen');
  assert.equal(draft.ingredients.length, 3);
  assert.deepEqual(draft.steps, [
    { section: 'Filling', text: 'Fry the onion.' },
    { section: 'Filling', text: 'Add the mince.' },
    { section: 'Topping', text: 'Whisk eggs & milk.' },
  ]);
  assert.deepEqual(draft.tags, ['dinner', 'south african', 'bobotie', 'mince']);
});

test('JSON-LD with instructions as one string and a relative image', () => {
  const html = jsonLdPage({
    '@type': 'Recipe',
    name: 'Toast',
    image: '/img/toast.jpg',
    recipeIngredient: ['1 slice bread'],
    recipeInstructions: '1. Toast the bread.\n2. Butter it.',
  });
  const { draft } = scrapeHtml(html, 'https://toast.example/recipes/toast');
  assert.equal(draft.image_url, 'https://toast.example/img/toast.jpg');
  assert.deepEqual(draft.steps.map((s) => s.text), ['Toast the bread.', 'Butter it.']);
  assert.equal(draft.source_name, 'Test Kitchen');
});

test('invalid JSON with raw newlines inside strings is still read', () => {
  const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Broken
JSON","recipeIngredient":["1 egg"]}</script>`;
  assert.equal(scrapeHtml(html, null).draft.name, 'Broken JSON');
});

test('microdata fallback', () => {
  const html = `<div itemscope itemtype="http://schema.org/Recipe">
    <h1 itemprop="name">Pancakes</h1><meta itemprop="recipeYield" content="4 servings">
    <meta itemprop="totalTime" content="PT25M">
    <ul><li itemprop="recipeIngredient">1 cup flour</li><li itemprop="recipeIngredient">1 egg</li></ul>
    <div itemprop="recipeInstructions"><ol><li>Mix.</li><li>Fry.</li></ol></div></div>`;
  const { draft, method } = scrapeHtml(html, 'https://old.example/p');
  assert.equal(method, 'microdata');
  assert.equal(draft.name, 'Pancakes');
  assert.equal(draft.servings, 4);
  assert.equal(draft.total_minutes, 25);
  assert.deepEqual(draft.ingredients.map((i) => i.raw), ['1 cup flour', '1 egg']);
  assert.deepEqual(draft.steps.map((s) => s.text), ['Mix.', 'Fry.']);
  assert.equal(draft.source_name, 'old.example');
});

test('page without recipe data gives a title/photo draft', () => {
  const html = `<html><head><title>My Blog</title><meta property="og:title" content="Gran's Koeksisters"><meta property="og:image" content="https://b.example/k.jpg"></head></html>`;
  const { draft, method } = scrapeHtml(html, 'https://b.example/post');
  assert.equal(method, 'page');
  assert.equal(draft.name, "Gran's Koeksisters");
  assert.equal(draft.image_url, 'https://b.example/k.jpg');
});

test('durations', () => {
  assert.equal(parseDuration('PT1H30M'), 90);
  assert.equal(parseDuration('P0DT0H45M'), 45);
  assert.equal(parseDuration('PT0S'), null);
  assert.equal(parseDuration('20 minutes'), null);
});

test('Grocy-style HTML preparation text into steps', () => {
  assert.deepEqual(htmlToSteps('<p>1.\tRoom botter en suiker</p><p>2. Meng melk</p>'), ['Room botter en suiker', 'Meng melk']);
  assert.deepEqual(htmlToSteps('<ol><li><span>Place chicken</span></li><li>Cover</li></ol>'), ['Place chicken', 'Cover']);
  assert.deepEqual(htmlToSteps(''), []);
});

test('pasted text with headings and sub-sections', () => {
  const d = parseRecipeText(`Easy Chicken Curry
Serves 4
Ingredients
- 500g chicken thighs
- 1 onion
For the sauce:
- 1 tin coconut milk
Method
1. Brown the chicken.
2. Add the rest.`);
  assert.equal(d.name, 'Easy Chicken Curry');
  assert.equal(d.servings, 4);
  assert.deepEqual(d.ingredients, [
    { section: null, raw: '500g chicken thighs' },
    { section: null, raw: '1 onion' },
    { section: 'For the sauce', raw: '1 tin coconut milk' },
  ]);
  assert.deepEqual(d.steps.map((s) => s.text), ['Brown the chicken.', 'Add the rest.']);
});

test('pasted text with no headings guesses ingredients from leading numbers', () => {
  const d = parseRecipeText(`Toast\n2 slices bread\nButter\nToast the bread until golden.`);
  assert.deepEqual(d.ingredients.map((i) => i.raw), ['2 slices bread']);
  assert.equal(d.steps.length, 2);
});
