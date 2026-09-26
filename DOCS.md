# KitchenAid

Recipes, a weekly meal plan, a shopping list and a light pantry — the parts
of Grocy that are actually useful day to day, without the stock levels,
chores, batteries and the rest — plus grocery price comparison, recipe
costing from what you paid (via BudgetPro), and access for AI assistants. No accounts or logins; everyone in the house who can
open Home Assistant shares the same recipes, plan and lists.

## Setup

1. Install the add-on and start it.
2. Open **Kitchen** from the Home Assistant sidebar (Ingress), or the "Open
   Web UI" link.
3. Coming from Grocy? Go to **Settings → Import from Grocy** (below) first.

## Recipes

- **Import** takes a link to almost any recipe site — AllRecipes, BBC Good
  Food, NYT Cooking, Food Network, Serious Eats, Jamie Oliver, Woolworths
  TASTE, Food24, and any blog using a recipe-card plugin. It reads the
  recipe data those sites publish for Google (schema.org), so there are no
  per-site scrapers to break. You always get to check and fix the result
  before it's saved; the photo is downloaded and kept locally.
- A site that refuses the request, or asks for a human check: KitchenAid
  doesn't try to get around that. Use **Paste text** instead — either the
  recipe copied from the page, or the whole page source (Ctrl+U, select all,
  copy), which gets read exactly like a fetched page.
- **New** lets you type a recipe in. Ingredients and method are plain text,
  one per line; a line ending in a colon (`For the sauce:`) starts a section.
- On a recipe, the **servings** stepper scales every amount. Tap ingredients
  to tick them off as you go and tap steps to mark them done. The ☀ button
  keeps the screen from sleeping while you cook — browsers only allow that
  over **https**, so it's greyed out when KitchenAid is opened over plain
  http on the LAN (open it through your https Home Assistant address to use
  it).
- Search matches recipe names **and** ingredients ("chicken" finds anything
  with chicken in it). Tags and favourites filter the grid.

## Meal plan

One row per day, Monday to Sunday. **+** on a day adds a recipe (with how
many servings) or just a note like "Leftovers" or "Eating out". Tap a meal
to change its day, meal, servings or remove it; on a computer you can also
drag it onto another day.

**Shop for this week** gathers every planned recipe's ingredients, scaled to
the planned servings and merged (two recipes needing onions → one line), and
lets you untick what you already have before it goes on the shopping list.
The same **Shopping list** button is on every recipe.

## Shopping list

- Type naturally: `2 kg potatoes`, `milk`, `3 tins chopped tomatoes`. Things
  you've bought before are suggested as you type.
- Items are grouped by **aisle**. New things get a best guess; move one to
  another aisle (⋯ → Aisle) and it's remembered for next time. Arrange the
  aisles in the order you walk through your shop under **Settings**.
- Adding something that's already on the list tops up the amount instead of
  adding a second line (500 g + 1 kg mince → 1.5 kg).
- Tap an item to tick it off; ticked items drop into **In the trolley**.
  **Clear ticked** removes them.
- The list refreshes itself every few seconds, so two people can shop from
  (or add to) the same list on different phones.
- More than one list (e.g. "Groceries" and "Makro") can be added under
  Settings.

## Pantry and items

**Pantry** shows what's at home, grouped by aisle. Things arrive when you
clear ticked items off the shopping list, from BudgetPro slips (below), by
scanning a barcode, or by typing ("2 kg rice"). **Used up** takes them out.
Deliberately no expiry dates or stock counts.

Every pantry line is an **item** in a catalogue (see *All items*). An item
is the kind of thing, not the brand — "Brown onion soup" — and can have any
number of:

- **barcodes** — Knorr's and Royco's both point to "Brown onion soup";
- **other names** — "Royco onion soup" typed on a list tops up the same line;
- **slip spellings** — how BudgetPro slips print it ("KNORR BRN ONION SOUP").

Tap an item to see and change these, set its aisle, or **merge** it into
another item it's really the same as (its barcodes, names and history move
across). **Scan** on the Pantry page opens a known barcode's item straight
away; an unknown one is looked up on Open Food Facts for a name, and you
link it to an existing item or start a new one. The camera only works over
https (the Home Assistant app, or your https HA address); over plain http
you can type the number or use a USB/Bluetooth barcode scanner.

Each item also remembers **what it last cost** — the pack price and the
unit price worked out from the pack size (R72 for 18 eggs → R4 each; R150
for 1.2 kg mince → R125/kg). That's what recipe costs use. It comes from
BudgetPro slips, or set it by hand on the item.

## Recipe costs

Under a recipe's ingredients, **Cost to make** adds up each ingredient's
amount × its item's unit price — only what's used, so 2 eggs at R4 each is
R8, not the R72 tray. It follows the servings stepper. Tap it for the
line-by-line breakdown. Ingredients never bought can be filled from today's
shop prices (if that search has been looked up in Prices), marked *shop
price*. Cup/spoon measures of things bought by weight are converted with
typical densities and marked *approx*.

## Prices

The **Prices** tab compares Pick n Pay, Makro and Woolworths (this used to
be the separate PriceScout add-on, which can now be uninstalled). Search,
compare per kg / litre, per item or per pack, narrow with must-include /
exclude words, fix a product's pack size by tapping it, and ☆ **Watch** a
search to have it refreshed daily. Each store is asked about a search at
most once a day (configurable); stores that refuse are left alone for six
hours, never worked around.

On the shopping list, **What will it cost?** matches every item to the
product at each store that covers the amount you need most cheaply (1.5 kg
mince → two 750 g packs), and shows each store's total and the cheapest mix
of shops. Tap an item to see what was picked. The first check each day asks
the stores about each item, so it takes a few seconds per item.

## Checkers and SPAR: prices from your slips

Checkers/Shoprite turn away automated requests (even a headless browser)
and SPAR has no web shop — each SPAR sets its own prices in the SPAR2U app.
KitchenAid doesn't try to get around that. Instead, every grocery line on
your BudgetPro slips is remembered as a price **at that shop**, and **What
will it cost?** opens with "What you paid last time": each shop's total for
the list, and how many of its items your slips cover. The more you shop
there, the better it gets. The item sheet shows the latest price per shop,
and the AI can ask via the `prices_paid` tool.

## BudgetPro

Set `budgetpro_url` (BudgetPro's own port, e.g. `http://10.1.1.3:8097`) and
`budgetpro_token` (BudgetPro → Settings → API & AI access) in the add-on's
**Configuration** tab and restart. Every 30 minutes (or **Check now**) new
*parsed* slips are read: lines in the `budgetpro_categories` categories
(default *Groceries*, subcategories included) go into the pantry with the
price paid, and matching shopping-list items are ticked off. Only slips from
the last week are read the first time. BudgetPro itself is never changed.

## AI assistants (MCP)

KitchenAid's port 8099 serves an MCP endpoint at `/mcp` for Claude (Code or
Desktop), Gemini CLI or any MCP client. **Settings → AI assistants** (opened
from the Home Assistant sidebar) shows the token and ready-to-paste setup
for each. Requests from the LAN need the token as
`Authorization: Bearer <token>`; **New token** revokes the old one.

Tools: `search_prices`, `price_history`, `price_shopping_list`,
`list_price_watchlist`, `watch_price`, `set_product_size`,
`search_recipes`, `get_recipe`, `recipe_cost`, `get_meal_plan`,
`plan_meal`, `get_shopping_list`, `add_to_shopping_list`, `get_pantry`,
`update_pantry`, `find_item`, `prices_paid`, `sync_budgetpro`.

Ask things like "Where's this week's shopping cheapest?", "What does the
bobotie cost per serving?", or "What can I make with what's in the pantry?".

## Pantry staples

Settings → **Pantry staples** lists things you always have (salt, oil,
water…). When a recipe's ingredients go to the shopping list these start
unticked, so they don't clutter it.

## Import from Grocy

Settings → **Import from Grocy** copies across:

- **Products with their barcodes**, so scanning already knows them.
- **Recipes** with their pictures, ingredient groups (as sections),
  included sub-recipes, and the preparation text as steps. Each gets the
  tag `grocy`.
- **Open shopping list items**, filed into aisles using your Grocy product
  groups.
- The **meal plan** (as dinners).
- Every **product name**, so autocomplete and aisles already know your
  groceries.

Grocy itself isn't changed, and running the import again only brings over
what's new. Use Grocy's own port — `http://<your-HA-IP>:9192` — not the
Home Assistant sidebar link (that's the HA frontend, not Grocy's API). Make
an API key in Grocy under *Settings → Manage API keys*; it's used for that
one import and not stored.

## Data

Everything lives in `/data` (the add-on's own storage, included in Home
Assistant backups): `kitchenaid.db` (SQLite: recipes, plan, lists, items,
prices) and `uploads/` (photos).
