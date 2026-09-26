// Words that turn one food into a different product: "potato" → "potato
// CHIPS", "butter" → "peanut butter energy BAR", "beef mince" → "mince beef
// flavour DOG FOOD". A slip line or shop product carrying one of these is
// not the item unless the item's own name has the word too ("Tomato paste"
// may match "tomato paste", "Tomato" may not).

const FORM_WORDS = [
  // snacks and sweets
  'chip', 'chips', 'crisp', 'crisps', 'bar', 'bars', 'snack', 'snacks', 'biscuit', 'biscuits', 'cookie', 'cookies', 'cake',
  'cakes', 'cupcake', 'cupcakes', 'muffin', 'muffins', 'cracker', 'crackers', 'rusk', 'rusks', 'chocolate', 'sweets',
  'lolly', 'lollies', 'gum', 'pudding', 'custard', 'dessert', 'icecream', 'energy', 'cereal', 'pie', 'pies',
  // drinks
  'juice', 'drink', 'drinks', 'cordial', 'milkshake', 'smoothie', 'soda',
  // sauces, spreads and flavourings
  'sauce', 'soup', 'spread', 'paste', 'pesto', 'dip', 'jam', 'marinade', 'seasoning', 'spice', 'spices', 'blend', 'blends', 'rub', 'stock', 'gravy',
  'dressing', 'relish', 'chutney', 'pickle', 'pickled', 'pickling', 'flavour', 'flavoured', 'flavor', 'flavored',
  'essence', 'extract', 'powder', 'oil', 'vinegar',
  // ready meals
  'pizza', 'sandwich', 'noodle', 'noodles', 'yoghurt', 'yogurt',
  // not for us
  'dog', 'dogs', 'cat', 'cats', 'pet', 'pets', 'puppy', 'kitten', 'bird', 'birdseed', 'purity', 'infant', 'month', 'months',
  // pet-food brands whose names never say "dog" ("Boss Mighty Chunks Lamb Stew")
  'boss', 'husky', 'bobtail', 'dogmor', 'catmor', 'pedigree', 'whiskas', 'purina', 'montego', 'friskies', 'felix', 'jock', 'epol', 'canin', 'hills', 'optimizor', 'acana', 'orijen',
];

const FORMS = new Set(FORM_WORDS);

const tokens = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean);

/**
 * True when `product` has a product-form word that `item` doesn't, so it's a
 * different thing: ("potato", "Willards Potato Chips") → true;
 * ("tomato paste", "Tomato Paste 50g") → false.
 */
export function differentProduct(item: string, product: string): boolean {
  const mine = new Set(tokens(item));
  return tokens(product).some((w) => FORMS.has(w) && !mine.has(w) && !mine.has(w.replace(/s$/, '')) && !mine.has(`${w}s`));
}
