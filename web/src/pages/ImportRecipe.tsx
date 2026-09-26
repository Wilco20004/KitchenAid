import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ImportResult } from '../types';
import RecipeEditor from '../components/RecipeEditor';
import Icon from '../components/Icon';

export default function ImportRecipe() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function run(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(mode === 'url' ? await api.importUrl(url.trim()) : await api.importText(text, url.trim() || undefined));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // #/recipes/import?url=… (e.g. from a bookmark) fetches straight away.
  useEffect(() => {
    if (params.get('url')) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Import a recipe</h1>
      </div>

      {!result && (
        <div className="panel">
          <div className="segmented" role="tablist">
            <button type="button" className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>
              From a link
            </button>
            <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
              Paste text
            </button>
          </div>

          <form onSubmit={run} className="import-form">
            {mode === 'url' ? (
              <>
                <div className="search-input big">
                  <Icon name="link" />
                  <input
                    type="url"
                    autoFocus
                    required
                    placeholder="https://www.example.com/best-bobotie-recipe"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
                <p className="muted small">
                  Works with most recipe sites — AllRecipes, BBC Good Food, NYT Cooking, Food Network, Serious Eats, Jamie Oliver,
                  Woolworths TASTE, Food24 and any blog using a recipe card plugin. You'll get to check everything before it's saved.
                </p>
              </>
            ) : (
              <>
                <textarea
                  rows={12}
                  autoFocus
                  required
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    'Paste a recipe — a title, then “Ingredients” and “Method” sections works best.\n\nA site that blocks importing? Paste the page source (Ctrl+U, select all, copy) here instead.'
                  }
                />
                <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Source link (optional)" />
              </>
            )}
            {error && <p className="error">{error}</p>}
            <div className="form-actions">
              <button type="submit" className="button" disabled={busy}>
                {busy ? 'Reading recipe…' : 'Import'}
              </button>
            </div>
          </form>
        </div>
      )}

      {result && (
        <>
          {result.existing && (
            <p className="notice">
              You already have this one: <Link to={`/recipes/${result.existing.id}`}>{result.existing.name}</Link>. Saving below makes a
              second copy.
            </p>
          )}
          {result.method === 'page' && (
            <p className="notice warn">
              That page has no recipe data a computer can read, so only the title and photo came through. Add the ingredients and method
              below, or go back and paste the recipe text instead.
            </p>
          )}
          <div className="row-between">
            <p className="muted small">Check it over — fix anything the site got wrong — then save.</p>
            <button type="button" className="link" onClick={() => setResult(null)}>
              Start over
            </button>
          </div>
          <RecipeEditor initial={result.draft} />
        </>
      )}
    </div>
  );
}
