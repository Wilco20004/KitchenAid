# Changelog

## 0.6.0 — 2026-09-26

- **Use-by dates in the pantry.** Set the date on the pack, or how long an
  item usually keeps (mince in the freezer: 3 months) — that's remembered,
  so each later purchase from a slip, the shopping list or by hand is dated
  on its own. More of something already at home keeps the earlier date.
- **Use soon** at the top of the pantry: anything expired or due within a
  week, soonest first, with the date on every pantry line.
- AI assistants see use-by dates in `get_pantry` (and can ask for just
  what's expiring) and can set them with `update_pantry`.
- `GET /api/pantry/expiring?days=3` for a Home Assistant sensor or
  notification.

## 0.5.2 — 2026-09-26

- Recipe costs no longer borrow a price across product forms in either
  direction: "tomato paste" isn't costed at the price of fresh tomatoes,
  nor "chicken stock" at the price of chicken.

## 0.5.1 — 2026-09-26

- Pet food whose name never says "dog" (Boss, Husky, Bobtail, Pedigree,
  Whiskas and other pet brands) is no longer matched as groceries — "lamb
  stew" found Boss Mighty Chunks.

## 0.5.0 — 2026-09-26

- **Slip lines no longer land on the wrong item.** A line for a different
  kind of product — potato *chips*, a peanut butter energy *bar*, a
  *flavoured* yoghurt, a chocolate *bar* — isn't matched to Potato, Butter,
  Bananas or Milk any more, so recipe costs stop using snack prices.
- **Better shop matches in "What will it cost?"**: whole words only ("rice"
  no longer finds Cori*celli* olive oil), no pet food or baby food, no
  sauces, pastes or spice blends unless asked for, and plain onions or
  potatoes before spring, baby or pickling ones.
- **Misread slips are ignored**: a BudgetPro slip dated in the future
  (OCR read the year wrong) is skipped until it's fixed in BudgetPro, and so
  is any line priced over R2,000 for one pack.
- **One-off clean-up on first start**: prices from misread slips are
  dropped, items that only existed because of one are deleted (and leave
  the pantry), and wrongly linked slip lines move to an item of their own.
  What it did is written to the add-on log.

## 0.4.0 — 2026-09-26

- **Live Checkers prices, optional**, through Parse (parse.bot) — a paid,
  third-party, unofficial API, because Checkers blocks automated requests
  itself. Off until `parse_api_key` is set in the add-on Configuration.
- Built for a fixed credit budget: at most `checkers_daily_searches`
  (default 10) broad searches a day and `checkers_monthly_credits`
  (default 300) a month, each pulling up to 100 products. Terms come from
  the shopping list, watchlist, recipes planned for the next 10 days and
  what you buy most; a term isn't re-searched for 3 days, and terms the
  catalogue already covers are skipped.
- Every search, list costing and recipe estimate matches the stored
  Checkers catalogue locally — no credits spent when you search.
- Settings → Checkers prices shows today's and this month's usage, catalogue
  size, what was searched and what's next, with a "use today's searches
  now" button.
- Store columns in "What will it cost?" follow however many stores are on.

## 0.3.0 — 2026-09-26

- **Prices you paid, per shop.** Every grocery line on a BudgetPro slip is
  kept as a price at that shop, so Checkers and SPAR — which publish no
  prices a program may read — can be compared from your own slips.
- The BudgetPro sync reads up to 6 months of older slips for prices only
  (they don't go into the pantry); slips synced before this version get
  their prices picked up too.
- **What will it cost?** now starts with "What you paid last time": each
  shop's total for the list from your slip prices (whole packs, enough for
  the amount), next to today's online prices.
- Item sheet lists the latest price paid at each shop.
- New MCP tool `prices_paid`; `find_item` includes prices per shop.
- A list item with no price history of its own uses the priced item its
  words point at ("milk" → "Clover Full Cream Milk" from the slips).

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
