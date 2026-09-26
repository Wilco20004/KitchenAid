import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, uploadUrl } from '../api/client';
import { RecipeSummary } from '../types';
import { formatMinutes, placeholderStyle } from '../utils/format';
import Icon from '../components/Icon';

// Share of a recipe's ingredients already at home (pantry + staples).
const ratio = (r: RecipeSummary) => (r.ingredient_count ? (r.have_count ?? 0) / r.ingredient_count : 0);
const atHome = (r: RecipeSummary) => ratio(r) >= 0.7;

export default function Recipes() {
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag') ?? '';
  const favorites = params.get('fav') === '1';
  const canMake = params.get('home') === '1';
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [tags, setTags] = useState<{ name: string; count: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listTags().then(setTags).catch(() => setTags([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .listRecipes({ q: query.trim(), tag, favorite: favorites })
        .then(setRecipes)
        .catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [query, tag, favorites]);

  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const filtering = Boolean(query.trim() || tag || favorites || canMake);

  return (
    <div>
      <div className="page-head">
        <h1>Recipes</h1>
        <div className="page-actions">
          <Link to="/recipes/import" className="button">
            <Icon name="download" /> Import
          </Link>
          <Link to="/recipes/new" className="button secondary">
            <Icon name="plus" /> New
          </Link>
        </div>
      </div>

      <div className="search-input big">
        <Icon name="search" />
        <input
          type="search"
          placeholder="Search by name or ingredient…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search recipes"
        />
      </div>

      <div className="chip-row scroll">
        <button type="button" className={`chip${favorites ? ' active' : ''}`} onClick={() => setFilter('fav', favorites ? null : '1')}>
          <Icon name="heart" size={14} filled={favorites} /> Favourites
        </button>
        <button type="button" className={`chip${canMake ? ' active' : ''}`} onClick={() => setFilter('home', canMake ? null : '1')}>
          <Icon name="box" size={14} /> Mostly at home
        </button>
        {tags.map((t) => (
          <button
            key={t.name}
            type="button"
            className={`chip${tag === t.name ? ' active' : ''}`}
            onClick={() => setFilter('tag', tag === t.name ? null : t.name)}
          >
            {t.name}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {recipes === null ? (
        <p className="muted">Loading…</p>
      ) : recipes.length === 0 ? (
        filtering ? (
          <div className="empty">
            <p>Nothing matches that.</p>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-emoji">🥘</div>
            <h2>No recipes yet</h2>
            <p className="muted">Paste a link from almost any recipe site, type one in, or bring your recipes over from Grocy.</p>
            <div className="page-actions center">
              <Link to="/recipes/import" className="button">
                Import from a website
              </Link>
              <Link to="/recipes/new" className="button secondary">
                Write one
              </Link>
              <Link to="/settings#grocy" className="button ghost">
                Import from Grocy
              </Link>
            </div>
          </div>
        )
      ) : (
        <div className="recipe-grid">
          {(canMake ? recipes.filter(atHome).sort((a, b) => ratio(b) - ratio(a)) : recipes).map((r) => (
            <Link key={r.id} to={`/recipes/${r.id}`} className="recipe-card">
              <div className="recipe-card-img">
                {uploadUrl(r.image_path) ? (
                  <img src={uploadUrl(r.image_path)!} alt="" loading="lazy" />
                ) : (
                  <div className="img-placeholder" style={placeholderStyle(r.name)}>{r.name.slice(0, 1).toUpperCase()}</div>
                )}
                {r.favorite && (
                  <span className="fav-badge" aria-label="Favourite">
                    <Icon name="heart" size={14} filled />
                  </span>
                )}
              </div>
              <div className="recipe-card-body">
                <strong>{r.name}</strong>
                <span className="muted small meta-line">
                  {formatMinutes(r.total_minutes) && (
                    <span>
                      <Icon name="clock" size={13} /> {formatMinutes(r.total_minutes)}
                    </span>
                  )}
                  {r.ingredient_count ? (
                    <span title="Ingredients at home (pantry + staples)">
                      <Icon name="box" size={13} /> {r.have_count}/{r.ingredient_count}
                    </span>
                  ) : null}
                  {r.servings && (
                    <span>
                      <Icon name="users" size={13} /> {r.servings}
                    </span>
                  )}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
