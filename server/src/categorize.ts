// First guess at an aisle for something never seen before. Once you move an
// item to another aisle, the item remembers that and this is skipped.
// Longest matching phrase wins, so "black pepper" beats "pepper".
const KEYWORDS: Record<string, string[]> = {
  'Fruit & Veg': [
    'onion', 'garlic', 'garlic clove', 'tomato', 'potato', 'sweet potato', 'carrot', 'lettuce', 'lettice', 'spinach',
    'cabbage', 'broccoli', 'cauliflower', 'cucumber', 'courgette', 'zucchini', 'baby marrow', 'butternut', 'pumpkin',
    'mushroom', 'celery', 'leek', 'bell pepper', 'green pepper', 'red pepper', 'yellow pepper', 'chilli', 'chili',
    'ginger', 'avocado', 'lemon', 'lime', 'orange', 'apple', 'banana', 'pear', 'grape', 'strawberry', 'blueberry',
    'berry', 'mango', 'pineapple', 'peach', 'corn', 'mielie', 'pea', 'green bean', 'bean sprout', 'spring onion',
    'shallot', 'beetroot', 'radish', 'kale', 'rocket', 'aubergine', 'eggplant', 'fresh parsley', 'fresh coriander',
    'fresh basil', 'fresh mint', 'salad', 'herb',
  ],
  'Meat & Fish': [
    'chicken', 'beef', 'mince', 'pork', 'lamb', 'bacon', 'sausage', 'boerewors', 'wors', 'steak', 'ham', 'salami',
    'chorizo', 'turkey', 'fish', 'salmon', 'tuna', 'hake', 'prawn', 'shrimp', 'mussel', 'calamari', 'fillet',
    'thigh', 'drumstick', 'breast', 'rib', 'pork belly', 'venison', 'biltong',
  ],
  'Dairy & Eggs': [
    'milk', 'butter', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'cream', 'sour cream', 'yoghurt',
    'yogurt', 'egg', 'cream cheese', 'mascarpone', 'ricotta', 'buttermilk', 'custard', 'maas',
  ],
  Bakery: ['bread', 'roll', 'bun', 'burger bun', 'wrap', 'tortilla', 'pita', 'naan', 'bagel', 'croissant', 'baguette'],
  Pantry: [
    'flour', 'cake flour', 'sugar', 'brown sugar', 'icing sugar', 'rice', 'pasta', 'spaghetti', 'macaroni', 'penne',
    'noodle', 'lasagne', 'oat', 'maize meal', 'pap', 'mielie meal', 'couscous', 'quinoa', 'lentil', 'chickpea',
    'bean', 'baked bean', 'tinned tomato', 'chopped tomato', 'tomato paste', 'coconut milk', 'coconut cream',
    'stock', 'stock pot', 'stock cube', 'broth', 'baking powder', 'baking soda', 'bicarbonate', 'yeast', 'cocoa',
    'cacao', 'chocolate', 'honey', 'jam', 'syrup', 'peanut butter', 'oil', 'olive oil', 'sunflower oil', 'vinegar',
    'breadcrumb', 'cornflour', 'corn flour', 'corn starch', 'cornstarch', 'maizena', 'vanilla', 'vanilla essence', 'nut', 'almond', 'walnut', 'raisin', 'cereal',
    'gelatine', 'custard powder',
  ],
  'Herbs & Spices': [
    'salt', 'pepper', 'black pepper', 'paprika', 'smoked paprika', 'cumin', 'turmeric', 'coriander', 'garam masala',
    'curry powder', 'masala', 'cinnamon', 'nutmeg', 'oregano', 'thyme', 'rosemary', 'basil', 'parsley', 'bay leaf',
    'chilli flake', 'crushed chilli', 'cayenne', 'onion powder', 'garlic powder', 'mixed herb', 'clove', 'cardamom',
    'star anise', 'ground ginger', 'spice', 'seasoning', 'aromat', 'braai salt', 'dill', 'sage', 'mint',
  ],
  'Sauces & Condiments': [
    'sauce', 'tomato sauce', 'ketchup', 'mayonnaise', 'mayo', 'mustard', 'soy sauce', 'worcestershire', 'chutney',
    'relish', 'pesto', 'hot sauce', 'peri-peri', 'fish sauce', 'sweet chilli sauce', 'bbq sauce', 'gherkin',
    'gurkin', 'pickle', 'olive', 'caper', 'dressing', 'white sauce',
  ],
  Frozen: ['frozen', 'ice cream', 'chip', 'frozen pea', 'puff pastry', 'pastry'],
  Drinks: ['juice', 'coffee', 'tea', 'soda', 'cola', 'beer', 'wine', 'water', 'sparkling', 'cooldrink'],
  Snacks: ['crisp', 'biscuit', 'cookie', 'popcorn', 'sweet', 'rusk', 'cracker'],
  Household: [
    'toilet paper', 'toilet roll', 'paper towel', 'dish soap', 'dishwashing', 'detergent', 'washing powder', 'bleach',
    'sponge', 'foil', 'cling wrap', 'bin bag', 'soap', 'shampoo', 'toothpaste', 'battery', 'light bulb',
  ],
};

const phrases = Object.entries(KEYWORDS)
  .flatMap(([category, words]) => words.map((w) => ({ w, category })))
  .sort((a, b) => b.w.length - a.w.length);

export function guessCategoryName(key: string): string | null {
  const padded = ` ${key} `;
  for (const { w, category } of phrases) {
    // "pea" should match "peas"/"pea" but not "peanut", so match whole words,
    // allowing a plural s on the phrase's last word.
    const re = new RegExp(`\\s${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\s`);
    if (re.test(padded)) return category;
  }
  return null;
}
