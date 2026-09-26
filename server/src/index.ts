import express from 'express';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from './db';
import { recipesRouter, tagsRouter } from './routes/recipes';
import { importRouter } from './routes/import';
import { mealPlanRouter } from './routes/mealplan';
import { shoppingRouter } from './routes/shopping';
import { categoriesRouter, staplesRouter } from './routes/settings';
import { pricesRouter } from './routes/prices';
import { itemsRouter } from './routes/items';
import { mcpRouter } from './mcp';
import { ingressOnly, requireToken } from './auth';
import { getMcpToken, regenerateMcpToken } from './settings';
import { startWatchlistRefresher } from './prices/search';
import { startBudgetProSync } from './budgetpro';

const app = express();
const PORT = Number(process.env.PORT) || 8099;

// Pasted page source can be large.
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d', immutable: true }));

app.use('/api/recipes', recipesRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/import', importRouter);
app.use('/api/mealplan', mealPlanRouter);
app.use('/api/shopping', shoppingRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/staples', staplesRouter);
app.use('/api/prices', pricesRouter);
app.use('/api', itemsRouter);

app.get('/api/mcp-token', ingressOnly, (_req, res) => res.json({ token: getMcpToken() }));
app.post('/api/mcp-token', ingressOnly, (_req, res) => res.json({ token: regenerateMcpToken() }));
app.use('/mcp', requireToken, mcpRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/mcp')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`KitchenAid server listening on port ${PORT}`);
  startWatchlistRefresher();
  startBudgetProSync();
});
