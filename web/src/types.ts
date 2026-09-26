export interface RecipeSummary {
  id: string;
  name: string;
  image_path: string | null;
  total_minutes: number | null;
  servings: number | null;
  favorite: boolean;
  source_name: string | null;
  tags: string[];
  ingredient_count?: number;
  have_count?: number;
}

export interface Ingredient {
  id: string;
  position: number;
  section: string | null;
  raw: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
  name: string;
  note: string | null;
}

export interface Step {
  id: string;
  position: number;
  section: string | null;
  text: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  source_url: string | null;
  source_name: string | null;
  image_path: string | null;
  notes: string | null;
  favorite: boolean;
  tags: string[];
  ingredients: Ingredient[];
  steps: Step[];
  created_at: string;
  updated_at: string;
}

/** What an import produces, and what the recipe editor edits. */
export interface RecipeDraft {
  name: string;
  description: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  source_url: string | null;
  source_name: string | null;
  image_url?: string | null;
  notes: string | null;
  tags: string[];
  ingredients: { section: string | null; raw: string }[];
  steps: { section: string | null; text: string }[];
}

export interface ImportResult {
  draft: RecipeDraft;
  method: 'json-ld' | 'microdata' | 'page' | 'text';
  existing: { id: string; name: string } | null;
}

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface MealPlanEntry {
  id: string;
  date: string;
  slot: Slot;
  position: number;
  recipe_id: string | null;
  title: string;
  servings: number | null;
  note: string | null;
  image_path: string | null;
  total_minutes: number | null;
  recipe_servings: number | null;
}

export interface ShoppingList {
  id: string;
  name: string;
  position: number;
  open_count: number;
}

export interface ShoppingItem {
  id: string;
  list_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  category_id: string | null;
  item_id: string | null;
  sources: string | null;
  checked: boolean;
  checked_at: string | null;
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

export interface Staple {
  name_key: string;
  name: string;
}

export interface PreviewLine {
  key: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  sources: string[];
  staple: boolean;
  in_pantry: boolean;
}

export interface GrocyImportResult {
  recipes: number;
  shopping_items: number;
  meal_plan: number;
  products: number;
  barcodes: number;
  skipped: number;
  warnings: string[];
}

// ---------- items & pantry ----------

export interface Item {
  id: string;
  name: string;
  category_id: string | null;
  category_name?: string | null;
  in_pantry: number;
  pantry_quantity: number | null;
  pantry_unit: string | null;
  pantry_note: string | null;
  pantry_source: string | null;
  bought_at: string | null;
  expires_at: string | null;
  keeps_days: number | null;
  pack_price: number | null;
  pack_label: string | null;
  unit_price: number | null;
  price_unit: 'item' | 'g' | 'ml' | null;
  price_source: string | null;
  price_at: string | null;
  barcode_count?: number;
}

export interface ItemAlias {
  kind: 'barcode' | 'name' | 'slip' | 'store';
  value: string;
  label: string | null;
  created_at: string;
}

export interface ItemDetail extends Item {
  aliases: ItemAlias[];
  paid?: PaidPrice[];
}

export interface BarcodeResult {
  code: string;
  item: ItemDetail | null;
  lookup?: { name: string | null; brand: string | null; quantity: string | null; image: string | null } | null;
  suggestions?: { id: string; name: string }[];
}

export interface BudgetProStatus {
  configured: boolean;
  url: string | null;
  categories: string[];
  lastSync: string | null;
  lastResult: { receipts: number; items: number; ticked: number; skipped: number } | null;
  lastError: string | null;
}

export interface CostLine {
  raw: string;
  item: string | null;
  cost: number | null;
  basis: 'paid' | 'store' | null;
  detail: string;
  approx?: boolean;
  price_at?: string | null;
}

export interface RecipeCost {
  recipe: string;
  servings: number | null;
  total: number;
  per_serving: number | null;
  priced: number;
  unpriced: number;
  from_store_prices: number;
  lines: CostLine[];
}

// ---------- prices ----------

export type Basis = 'measure' | 'item' | 'pack';

export interface StoreStatus {
  store: string;
  name: string;
  fetchedAt: string | null;
  refreshed: boolean;
  error: string | null;
  count: number;
  pausedUntil: string | null;
}

export interface Product {
  id: string;
  store: string;
  storeName: string;
  name: string;
  brand: string | null;
  sizeText: string | null;
  sizeOverride: string | null;
  price: number;
  wasPrice: number | null;
  promo: string | null;
  url: string | null;
  imageUrl: string | null;
  inStock: boolean | null;
  rank: number;
  packCount: number;
  perItem: number | null;
  perMeasure: number | null;
  measureLabel: string | null;
  updatedAt: string;
}

export interface SearchResponse {
  term: string;
  termKey: string;
  stores: StoreStatus[];
  products: Product[];
}

export interface RecentTerm {
  termKey: string;
  term: string;
  fetchedAt: string;
}

export interface WatchItem {
  termKey: string;
  term: string;
  includeWords: string;
  excludeWords: string;
  basis: Basis;
  createdAt: string;
}

export interface ItemMatch {
  name: string;
  term: string;
  stores: {
    store: string;
    storeName: string;
    best: { product: Product; packs: number; cost: number } | null;
    alternatives: { product: Product; packs: number; cost: number }[];
    error: string | null;
  }[];
}

export interface PaidPrice {
  store: string | null;
  pack_price: number;
  pack_label: string | null;
  unit_price: number;
  price_unit: 'item' | 'g' | 'ml';
  seen_at: string;
  source: string;
}

export interface PaidResult {
  stores: { store: string; total: number; found: number; missing: string[] }[];
  items: { name: string; item: string | null; prices: { store: string; packs: number; cost: number; pack_price: number; pack_label: string | null; seen_at: string }[] }[];
}
