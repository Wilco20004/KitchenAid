import { Router } from 'express';
import { db } from '../db';
import { fetchPage, ImportError } from '../import/fetch';
import { parseRecipeText, scrapeHtml } from '../import/scrape';
import { importFromGrocy } from '../import/grocy';

export const importRouter = Router();

// Nothing here saves a recipe: each returns a draft that the recipe form
// shows for checking, and saving that form creates it.

function existingFor(url: string | null) {
  if (!url) return null;
  return (db.prepare('SELECT id, name FROM recipes WHERE source_url = ?').get(url) as { id: string; name: string } | undefined) ?? null;
}

// POST /api/import/url { url }
importRouter.post('/url', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url) return res.status(400).json({ error: 'Paste a link to a recipe' });
  try {
    const { html, finalUrl } = await fetchPage(url);
    const { draft, method } = scrapeHtml(html, finalUrl);
    res.json({ draft, method, existing: existingFor(draft.source_url) ?? existingFor(url) });
  } catch (e: any) {
    res.status(e instanceof ImportError ? 422 : 500).json({ error: e.message });
  }
});

// POST /api/import/text { text, url? } — pasted recipe text, or a page's HTML source
importRouter.post('/text', (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) return res.status(400).json({ error: 'Paste some recipe text' });
  const url = typeof req.body?.url === 'string' && req.body.url.trim() ? req.body.url.trim() : null;
  if (/<(html|head|body|script|div)[\s>]/i.test(text)) {
    const { draft, method } = scrapeHtml(text, url);
    if (method !== 'page') return res.json({ draft, method, existing: existingFor(draft.source_url) });
  }
  const draft = parseRecipeText(text);
  draft.source_url = url;
  res.json({ draft, method: 'text', existing: existingFor(url) });
});

// POST /api/import/grocy { url, api_key, recipes, shopping, mealplan, products }
// The API key is used for this one request and never stored.
importRouter.post('/grocy', async (req, res) => {
  try {
    res.json(await importFromGrocy(req.body ?? {}));
  } catch (e: any) {
    res.status(e instanceof ImportError ? 422 : 500).json({ error: e.message });
  }
});
