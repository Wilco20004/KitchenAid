# Changelog

## 0.2.1 — 2026-09-26

- Moved to port 8099 (web UI, Ingress and the MCP endpoint). AI assistants
  set up against :8096 need the new address from Settings → AI assistants.

## 0.2.0 — 2026-09-26

- **Prices** tab: PriceScout is now part of KitchenAid — compare Pick n Pay,
  Makro and Woolworths per kg / litre / item, daily watchlist, hand-set
  pack sizes. Same once-a-day-per-search manners towards the stores.
- **What will it cost?** on the shopping list: every item matched to each
  store's cheapest product that covers the amount needed, totals per store
  and the cheapest mix of shops.
- **Pantry** tab: what's at home, fed by ticking off the shopping list,
  BudgetPro grocery slips, barcode scans or typing.
- **Items with barcodes**: one item can carry many barcodes, slip spellings
  and other names (Knorr and Royco onion soup → "Brown onion soup"); merge
  duplicates; unknown barcodes are looked up on Open Food Facts.
- **BudgetPro link**: new grocery slips (checked every 30 minutes) put what
  you bought in the pantry with the price paid per item / gram / ml, and tick
  it off the shopping list.
- **Recipe cost** from prices actually paid, counting only the amount used
  (2 eggs at R4 = R8), scaling with servings; gaps can be filled from cached
  shop prices.
- Recipes show how many ingredients are at home, with a "Mostly at home"
  filter; things at home start unticked when sending a recipe to the list.
- **MCP endpoint** (`/mcp`, token in Settings → AI assistants) so Claude or
  Gemini can search prices, price the list, cost recipes, and read/update
  recipes, meal plan, shopping list and pantry.
- Grocy import also brings product barcodes.
- "1 dozen eggs" is understood as 12.

## 0.1.0 — 2026-09-25

- First version: recipes, meal plan and shopping list.
- Import recipes from a link (any site publishing schema.org recipe data),
  from pasted text, or from pasted page source; review before saving.
- Scale recipes by servings; tick off ingredients and steps while cooking;
  keep-screen-on when opened over https.
- Weekly meal plan with recipes or notes; drag to move on desktop; send the
  week's ingredients (scaled and merged) to the shopping list.
- Shopping list grouped by aisle, with remembered aisles, autocomplete,
  automatic merging of repeat items, multiple lists and live refresh.
- Pantry staples start unticked when adding a recipe's ingredients.
- One-time import from Grocy: recipes with pictures, open shopping list,
  meal plan and product names.
