# KitchenAid

A Home Assistant add-on for recipes (imported from recipe sites or typed
in), a weekly meal plan, a shared shopping list grouped by aisle, a pantry
with barcodes and prices paid (fed by BudgetPro slips), grocery price
comparison across Pick n Pay, Makro and Woolworths (formerly PriceScout),
recipe costing, and an MCP endpoint for AI assistants. Includes a one-time
importer for existing Grocy data.

See [DOCS.md](DOCS.md) for how to use it.

## Development

```bash
npm install
npm run dev:server   # API on :8096
npm run dev:web      # Vite on :5173, proxies /api and /uploads
npm test             # parsers, importers, items, costing, store adapters
```

Stack: Express + better-sqlite3 (`server/`), React + Vite (`web/`), matching
the other home add-ons. Recipe import reads schema.org JSON-LD / microdata
(`server/src/import/scrape.ts`); ingredient parsing, unit merging and
scaling live in `server/src/ingredients.ts`; the Grocy importer is
`server/src/import/grocy.ts`. Items, aliases and the pantry are
`server/src/items.ts`; recipe costing `server/src/costing.ts`; the BudgetPro
sync `server/src/budgetpro.ts`; prices (the old PriceScout) live in
`server/src/prices/`; the MCP tools are in `server/src/mcp.ts`.
