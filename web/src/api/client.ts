import {
  BarcodeResult,
  Basis,
  BudgetProStatus,
  Item,
  ItemDetail,
  ItemMatch,
  PaidResult,
  Product,
  RecentTerm,
  RecipeCost,
  SearchResponse,
  WatchItem,
  Category,
  GrocyImportResult,
  ImportResult,
  MealPlanEntry,
  PreviewLine,
  Recipe,
  RecipeDraft,
  RecipeSummary,
  ShoppingItem,
  ShoppingList,
  Slot,
  Staple,
} from '../types';

// Every path is relative (no leading slash) so it resolves under Home
// Assistant's per-session Ingress prefix.
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

export const uploadUrl = (file: string | null) => (file ? `uploads/${file}` : null);

export interface MealPlanInput {
  date: string;
  slot: Slot;
  recipe_id?: string | null;
  title?: string;
  servings?: number | null;
  note?: string | null;
}

export interface NewShoppingItem {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
  source?: string | null;
  category_id?: string | null;
}

export const api = {
  listRecipes: (params: { q?: string; tag?: string; favorite?: boolean } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.tag) search.set('tag', params.tag);
    if (params.favorite) search.set('favorite', '1');
    const s = search.toString();
    return request<RecipeSummary[]>(`api/recipes${s ? `?${s}` : ''}`);
  },
  getRecipe: (id: string) => request<Recipe>(`api/recipes/${id}`),
  createRecipe: (data: RecipeDraft) => request<Recipe>('api/recipes', json('POST', data)),
  updateRecipe: (id: string, data: RecipeDraft) => request<Recipe>(`api/recipes/${id}`, json('PUT', data)),
  deleteRecipe: (id: string) => request<void>(`api/recipes/${id}`, { method: 'DELETE' }),
  setFavorite: (id: string, favorite: boolean) => request<Recipe>(`api/recipes/${id}/favorite`, json('PUT', { favorite })),
  uploadRecipePhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append('photo', file);
    return request<Recipe>(`api/recipes/${id}/photo`, { method: 'POST', body: form });
  },
  deleteRecipePhoto: (id: string) => request<Recipe>(`api/recipes/${id}/photo`, { method: 'DELETE' }),
  recipeShoppingPreview: (id: string, servings: number | null) =>
    request<PreviewLine[]>(`api/recipes/${id}/shopping-preview`, json('POST', { servings })),
  listTags: () => request<{ name: string; count: number }[]>('api/tags'),

  importUrl: (url: string) => request<ImportResult>('api/import/url', json('POST', { url })),
  importText: (text: string, url?: string) => request<ImportResult>('api/import/text', json('POST', { text, url })),
  importGrocy: (data: { url: string; api_key: string; recipes: boolean; shopping: boolean; mealplan: boolean; products: boolean }) =>
    request<GrocyImportResult>('api/import/grocy', json('POST', data)),

  listMealPlan: (start: string, end: string) => request<MealPlanEntry[]>(`api/mealplan?start=${start}&end=${end}`),
  addMealPlan: (data: MealPlanInput) => request<MealPlanEntry>('api/mealplan', json('POST', data)),
  updateMealPlan: (id: string, data: Partial<MealPlanInput>) => request<MealPlanEntry>(`api/mealplan/${id}`, json('PUT', data)),
  deleteMealPlan: (id: string) => request<void>(`api/mealplan/${id}`, { method: 'DELETE' }),
  mealPlanShoppingPreview: (start: string, end: string) =>
    request<PreviewLine[]>('api/mealplan/shopping-preview', json('POST', { start, end })),

  listShoppingLists: () => request<ShoppingList[]>('api/shopping/lists'),
  createShoppingList: (name: string) => request<ShoppingList>('api/shopping/lists', json('POST', { name })),
  renameShoppingList: (id: string, name: string) => request<ShoppingList>(`api/shopping/lists/${id}`, json('PUT', { name })),
  deleteShoppingList: (id: string) => request<void>(`api/shopping/lists/${id}`, { method: 'DELETE' }),
  listItems: (listId: string) => request<ShoppingItem[]>(`api/shopping/lists/${listId}/items`),
  addItemText: (listId: string, text: string) => request<ShoppingItem>(`api/shopping/lists/${listId}/items`, json('POST', { text })),
  addItemsBulk: (listId: string, items: NewShoppingItem[]) =>
    request<{ added: number }>(`api/shopping/lists/${listId}/items/bulk`, json('POST', { items })),
  updateItem: (id: string, data: Partial<Omit<ShoppingItem, 'id' | 'list_id'>>) =>
    request<ShoppingItem>(`api/shopping/items/${id}`, json('PUT', data)),
  deleteItem: (id: string) => request<void>(`api/shopping/items/${id}`, { method: 'DELETE' }),
  clearChecked: (listId: string, toPantry = true) =>
    request<{ removed: number; toPantry: number }>(`api/shopping/lists/${listId}/clear-checked`, json('POST', { toPantry })),
  suggest: (q: string) => request<{ name: string; category_id: string | null }[]>(`api/shopping/suggest?q=${encodeURIComponent(q)}`),

  listCategories: () => request<Category[]>('api/categories'),
  createCategory: (name: string) => request<Category>('api/categories', json('POST', { name })),
  renameCategory: (id: string, name: string) => request<Category>(`api/categories/${id}`, json('PUT', { name })),
  reorderCategories: (ids: string[]) => request<Category[]>('api/categories/order', json('PUT', { ids })),
  deleteCategory: (id: string) => request<void>(`api/categories/${id}`, { method: 'DELETE' }),

  recipeCost: (id: string, servings: number | null, store: boolean) =>
    request<RecipeCost>(`api/recipes/${id}/cost?${servings ? `servings=${servings}&` : ''}${store ? 'store=1' : ''}`),

  // items & pantry
  listCatalog: (params: { q?: string; pantry?: boolean } = {}) => {
    const s = new URLSearchParams();
    if (params.q) s.set('q', params.q);
    if (params.pantry) s.set('pantry', '1');
    return request<Item[]>(`api/items?${s}`);
  },
  getCatalogItem: (id: string) => request<ItemDetail>(`api/items/${id}`),
  createCatalogItem: (data: { name: string; category_id?: string | null; barcode?: string; barcode_label?: string | null }) =>
    request<ItemDetail>('api/items', json('POST', data)),
  updateCatalogItem: (id: string, data: { name?: string; category_id?: string | null }) => request<ItemDetail>(`api/items/${id}`, json('PUT', data)),
  deleteCatalogItem: (id: string) => request<void>(`api/items/${id}`, { method: 'DELETE' }),
  addPantryText: (text: string) => request<Item>('api/pantry', json('POST', { text })),
  putInPantry: (id: string, data: { quantity?: number | null; unit?: string | null; note?: string | null } = {}) =>
    request<Item>(`api/items/${id}/pantry`, json('POST', data)),
  usedUp: (id: string) => request<ItemDetail>(`api/items/${id}/pantry`, { method: 'DELETE' }),
  setItemPrice: (id: string, pack_price: number, pack_label: string) =>
    request<ItemDetail>(`api/items/${id}/price`, json('PUT', { pack_price, pack_label })),
  addAlias: (id: string, kind: string, value: string, label?: string | null) =>
    request<ItemDetail>(`api/items/${id}/aliases`, json('POST', { kind, value, label })),
  removeAlias: (id: string, kind: string, value: string) =>
    request<ItemDetail>(`api/items/${id}/aliases?kind=${encodeURIComponent(kind)}&value=${encodeURIComponent(value)}`, { method: 'DELETE' }),
  mergeItem: (id: string, into: string) => request<ItemDetail>(`api/items/${id}/merge`, json('POST', { into })),
  lookupBarcode: (code: string) => request<BarcodeResult>(`api/barcode/${encodeURIComponent(code)}`),
  budgetProStatus: () => request<BudgetProStatus>('api/budgetpro'),
  syncBudgetPro: () => request<{ receipts: number; items: number; ticked: number; skipped: number }>('api/budgetpro/sync', { method: 'POST' }),

  // prices
  priceStores: () => request<{ id: string; name: string }[]>('api/prices/stores'),
  searchPrices: (q: string, force = false) =>
    request<SearchResponse>(`api/prices/search?q=${encodeURIComponent(q)}${force ? '&force=1' : ''}`),
  recentPriceSearches: () => request<RecentTerm[]>('api/prices/recent'),
  setProductSize: (id: string, sizeOverride: string | null) =>
    request<Product>(`api/prices/products/${encodeURIComponent(id)}`, json('PATCH', { sizeOverride })),
  priceWatchlist: () => request<WatchItem[]>('api/prices/watchlist'),
  watchPrice: (item: { term: string; includeWords: string; excludeWords: string; basis: Basis }) =>
    request<WatchItem>('api/prices/watchlist', json('POST', item)),
  unwatchPrice: (termKey: string) => request<void>(`api/prices/watchlist/${encodeURIComponent(termKey)}`, { method: 'DELETE' }),
  paidPrices: (items: { item_id?: string | null; name: string; quantity: number | null; unit: string | null }[]) =>
    request<PaidResult>('api/prices/paid', json('POST', { items })),
  matchItem: (item: { name: string; quantity: number | null; unit: string | null }) =>
    request<ItemMatch>('api/prices/match', json('POST', item)),

  checkersStatus: () => request<any>('api/prices/checkers'),
  runCheckers: () => request<unknown>('api/prices/checkers/run', { method: 'POST' }),
  getMcpToken: () => request<{ token: string }>('api/mcp-token'),
  regenerateMcpToken: () => request<{ token: string }>('api/mcp-token', { method: 'POST' }),

  listStaples: () => request<Staple[]>('api/staples'),
  addStaple: (name: string) => request<Staple>('api/staples', json('POST', { name })),
  deleteStaple: (key: string) => request<void>(`api/staples/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};
