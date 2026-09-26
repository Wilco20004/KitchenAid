import { useEffect, useMemo, useState } from 'react';
import { api, uploadUrl } from '../api/client';
import { RecipeSummary, Slot } from '../types';
import { addDays, dayLabel, today } from '../utils/dates';
import Modal from './Modal';
import Icon from './Icon';

export const SLOTS: { value: Slot; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

/**
 * Put something on the meal plan. Opened from a recipe (recipe fixed, pick
 * the day) or from a day on the plan (day fixed, pick a recipe or type a note).
 */
export default function AddToPlanDialog({
  date: fixedDate,
  recipe: fixedRecipe,
  onClose,
  onSaved,
}: {
  date?: string;
  recipe?: { id: string; name: string; servings: number | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(fixedDate ?? today());
  const [slot, setSlot] = useState<Slot>('dinner');
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [recipeId, setRecipeId] = useState<string | null>(fixedRecipe?.id ?? null);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [servings, setServings] = useState<number | ''>(fixedRecipe?.servings ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fixedRecipe) api.listRecipes().then(setRecipes).catch((e) => setError(e.message));
  }, [fixedRecipe]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? recipes.filter((r) => r.name.toLowerCase().includes(q) || r.tags.some((t) => t.includes(q))) : recipes).slice(0, 40);
  }, [recipes, query]);

  const picked = recipes.find((r) => r.id === recipeId) ?? null;
  const chosen = fixedRecipe ?? picked;
  const chosenImage = uploadUrl(picked?.image_path ?? null);

  function pick(r: RecipeSummary) {
    setRecipeId(r.id);
    setServings(r.servings ?? '');
    setNote('');
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.addMealPlan({
        date,
        slot,
        recipe_id: recipeId,
        title: recipeId ? undefined : note.trim() || query.trim(),
        servings: servings === '' ? null : servings,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  const quickDays = Array.from({ length: 7 }, (_v, i) => addDays(today(), i));
  const canSave = Boolean(recipeId || note.trim() || query.trim());

  return (
    <Modal
      title={fixedRecipe ? `Plan “${fixedRecipe.name}”` : `Plan ${dayLabel(date).weekday} ${dayLabel(date).day} ${dayLabel(date).month}`}
      onClose={onClose}
      footer={
        <button type="button" className="button" onClick={save} disabled={busy || !canSave}>
          {busy ? 'Saving…' : recipeId ? 'Add to plan' : 'Add note'}
        </button>
      }
    >
      {error && <p className="error">{error}</p>}

      {!fixedDate && (
        <div className="field">
          <span className="label">Day</span>
          <div className="chip-row">
            {quickDays.map((d, i) => {
              const l = dayLabel(d);
              return (
                <button key={d} type="button" className={`chip${d === date ? ' active' : ''}`} onClick={() => setDate(d)}>
                  {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${l.weekday} ${l.day}`}
                </button>
              );
            })}
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Other day" />
          </div>
        </div>
      )}

      <div className="field">
        <span className="label">Meal</span>
        <div className="segmented">
          {SLOTS.map((s) => (
            <button key={s.value} type="button" className={slot === s.value ? 'active' : ''} onClick={() => setSlot(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!fixedRecipe && (
        <div className="field">
          <span className="label">Recipe</span>
          {chosen ? (
            <div className="picked">
              {chosenImage ? (
                <img src={chosenImage} alt="" />
              ) : (
                <span className="thumb-placeholder small">🍽️</span>
              )}
              <strong>{chosen.name}</strong>
              <button type="button" className="icon-button" onClick={() => setRecipeId(null)} aria-label="Choose another">
                <Icon name="x" />
              </button>
            </div>
          ) : (
            <>
              <div className="search-input">
                <Icon name="search" />
                <input
                  autoFocus
                  placeholder="Search recipes — or type a note like “Leftovers”"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <ul className="pick-list">
                {filtered.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => pick(r)}>
                      {uploadUrl(r.image_path) ? <img src={uploadUrl(r.image_path)!} alt="" /> : <span className="thumb-placeholder small">🍽️</span>}
                      <span>{r.name}</span>
                    </button>
                  </li>
                ))}
                {filtered.length === 0 && query.trim() && (
                  <li className="muted small pad">No recipe called that — it'll be added as a note.</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      {recipeId && (
        <label className="field inline">
          <span className="label">Servings</span>
          <input
            type="number"
            min={1}
            className="narrow"
            value={servings}
            onChange={(e) => setServings(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
          />
        </label>
      )}
    </Modal>
  );
}
