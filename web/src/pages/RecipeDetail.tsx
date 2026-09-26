import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, uploadUrl } from '../api/client';
import { Recipe } from '../types';
import { bySection, formatMinutes, scaledLine } from '../utils/format';
import Icon from '../components/Icon';
import AddToListDialog from '../components/AddToListDialog';
import AddToPlanDialog from '../components/AddToPlanDialog';
import RecipeCostPanel from '../components/RecipeCostPanel';

// Screen Wake Lock only exists in secure contexts (https or localhost). Over
// plain http on the LAN it's undefined, so the button explains that instead
// of silently doing nothing.
const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator && window.isSecureContext;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Source';
  }
}

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [servings, setServings] = useState(1);
  const [haveIngredients, setHaveIngredients] = useState<Set<string>>(new Set());
  const [doneSteps, setDoneSteps] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'list' | 'plan' | null>(null);
  const [planned, setPlanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awake, setAwake] = useState(false);
  const lock = useRef<any>(null);

  useEffect(() => {
    api
      .getRecipe(id!)
      .then((r) => {
        setRecipe(r);
        setServings(r.servings ?? 1);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => () => void lock.current?.release?.(), []);

  const loadPreview = useCallback(() => api.recipeShoppingPreview(id!, servings), [id, servings]);

  async function toggleAwake() {
    if (awake) {
      await lock.current?.release();
      lock.current = null;
      setAwake(false);
      return;
    }
    try {
      lock.current = await (navigator as any).wakeLock.request('screen');
      lock.current.addEventListener('release', () => setAwake(false));
      setAwake(true);
    } catch (e: any) {
      setError(`Couldn't keep the screen on: ${e.message}`);
    }
  }

  async function toggleFavorite() {
    if (!recipe) return;
    setRecipe(await api.setFavorite(recipe.id, !recipe.favorite));
  }

  async function remove() {
    if (!recipe || !confirm(`Delete “${recipe.name}”? This can't be undone.`)) return;
    await api.deleteRecipe(recipe.id);
    navigate('/', { replace: true });
  }

  function toggle(setter: typeof setDoneSteps, key: string) {
    setter((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (error && !recipe) return <p className="error">{error}</p>;
  if (!recipe) return <p className="muted">Loading…</p>;

  const factor = recipe.servings ? servings / recipe.servings : 1;
  const image = uploadUrl(recipe.image_path);
  const times = [
    ['Prep', recipe.prep_minutes],
    ['Cook', recipe.cook_minutes],
    ['Total', recipe.total_minutes],
  ].filter(([, m]) => m) as [string, number][];

  return (
    <article className="recipe">
      <div className={`recipe-hero${image ? '' : ' no-image'}`}>
        {image && <img src={image} alt="" />}
        <div className="recipe-hero-text">
          <Link to="/" className="back-link">
            <Icon name="left" size={16} /> Recipes
          </Link>
          <h1>{recipe.name}</h1>
          {recipe.description && <p className="lead">{recipe.description}</p>}
          <div className="meta-line">
            {times.map(([label, m]) => (
              <span key={label}>
                <Icon name="clock" size={14} /> {label} {formatMinutes(m)}
              </span>
            ))}
            {recipe.source_url && (
              <a href={recipe.source_url} target="_blank" rel="noreferrer">
                <Icon name="link" size={14} /> {recipe.source_name || hostOf(recipe.source_url)}
              </a>
            )}
          </div>
          {recipe.tags.length > 0 && (
            <div className="chip-row">
              {recipe.tags.map((t) => (
                <Link key={t} to={`/?tag=${encodeURIComponent(t)}`} className="chip small">
                  {t}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="toolbar">
        <button type="button" className="button" onClick={() => setDialog('plan')}>
          <Icon name="calendar" /> {planned ? 'Planned ✓' : 'Add to plan'}
        </button>
        <button type="button" className="button secondary" onClick={() => setDialog('list')}>
          <Icon name="cart" /> Shopping list
        </button>
        <button
          type="button"
          className={`icon-button bordered${recipe.favorite ? ' fav' : ''}`}
          onClick={toggleFavorite}
          aria-label={recipe.favorite ? 'Remove from favourites' : 'Add to favourites'}
          title="Favourite"
        >
          <Icon name="heart" filled={recipe.favorite} />
        </button>
        <button
          type="button"
          className={`icon-button bordered${awake ? ' on' : ''}`}
          onClick={toggleAwake}
          disabled={!wakeLockSupported}
          title={
            wakeLockSupported
              ? awake
                ? 'Screen stays on — tap to stop'
                : 'Keep the screen on while cooking'
              : 'Keeping the screen on needs a secure (https) connection — open KitchenAid through your https Home Assistant address to use it'
          }
          aria-label="Keep screen on"
        >
          <Icon name="sun" />
        </button>
        <span className="toolbar-spacer" />
        <Link to={`/recipes/${recipe.id}/edit`} className="icon-button bordered" aria-label="Edit" title="Edit">
          <Icon name="edit" />
        </Link>
        <button type="button" className="icon-button bordered danger" onClick={remove} aria-label="Delete" title="Delete">
          <Icon name="trash" />
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="recipe-columns">
        <section className="panel ingredients">
          <div className="row-between">
            <h2>Ingredients</h2>
            <div className="stepper" aria-label="Servings">
              <button type="button" onClick={() => setServings((s) => Math.max(1, s - 1))} aria-label="Fewer servings">
                −
              </button>
              <span>
                <strong>{servings}</strong> {servings === 1 ? 'serving' : 'servings'}
              </span>
              <button type="button" onClick={() => setServings((s) => s + 1)} aria-label="More servings">
                +
              </button>
            </div>
          </div>
          {!recipe.servings && <p className="muted tiny">Set the recipe's servings (Edit) to scale amounts.</p>}
          <RecipeCostPanel recipeId={recipe.id} servings={servings} />
          {recipe.ingredients.length === 0 && <p className="muted">No ingredients listed.</p>}
          {bySection(recipe.ingredients).map((g, gi) => (
            <div key={gi}>
              {g.section && <h3>{g.section}</h3>}
              <ul className="tick-list">
                {g.rows.map((ing) => (
                  <li key={ing.id} className={haveIngredients.has(ing.id) ? 'done' : ''} onClick={() => toggle(setHaveIngredients, ing.id)}>
                    <span className="tick" aria-hidden="true">
                      {haveIngredients.has(ing.id) && <Icon name="check" size={14} />}
                    </span>
                    <span>{recipe.servings ? scaledLine(ing, factor) : ing.raw}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="panel steps">
          <h2>Method</h2>
          {recipe.steps.length === 0 && <p className="muted">No steps written down.</p>}
          {bySection(recipe.steps).map((g, gi) => (
            <div key={gi}>
              {g.section && <h3>{g.section}</h3>}
              <ol className="step-list">
                {g.rows.map((s) => (
                  <li key={s.id} className={doneSteps.has(s.id) ? 'done' : ''} onClick={() => toggle(setDoneSteps, s.id)}>
                    <p>{s.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {recipe.notes && (
            <div className="notes">
              <h3>Notes</h3>
              <p>{recipe.notes}</p>
            </div>
          )}
        </section>
      </div>

      {dialog === 'list' && (
        <AddToListDialog title={`Shopping for ${servings} serving${servings === 1 ? '' : 's'}`} load={loadPreview} onClose={() => setDialog(null)} />
      )}
      {dialog === 'plan' && (
        <AddToPlanDialog
          recipe={{ id: recipe.id, name: recipe.name, servings }}
          onClose={() => setDialog(null)}
          onSaved={() => setPlanned(true)}
        />
      )}
    </article>
  );
}
