import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Item, Recipe } from '../types';
import Modal from './Modal';

/**
 * Which item is each ingredient? Unlinked ingredients of a recipe with the
 * item KitchenAid thinks they are filled in — nothing links itself until
 * it's confirmed here. "Don't link" stops the question for things like water.
 */
export default function LinkReviewDialog({ recipe, onClose, onSaved }: { recipe: Recipe; onClose: () => void; onSaved: (r: Recipe) => void }) {
  const todo = useMemo(() => recipe.ingredients.filter((i) => !i.item_id && !i.no_link), [recipe]);
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [picks, setPicks] = useState<Record<string, { name: string; skip: boolean }>>(() =>
    Object.fromEntries(todo.map((i) => [i.id, { name: i.suggested?.name ?? '', skip: false }]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);
  const byName = useMemo(() => new Map(catalog.map((i) => [i.name.trim().toLowerCase(), i])), [catalog]);

  const set = (id: string, patch: Partial<{ name: string; skip: boolean }>) => setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const chosen = todo.filter((i) => picks[i.id]?.skip || picks[i.id]?.name.trim());

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const links = chosen.map((i) => {
        const p = picks[i.id];
        if (p.skip) return { id: i.id, no_link: true };
        const hit = byName.get(p.name.trim().toLowerCase());
        return hit ? { id: i.id, item_id: hit.id } : { id: i.id, item_name: p.name.trim() };
      });
      onSaved(await api.setIngredientLinks(recipe.id, links));
      onClose();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Link ingredients to items"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="toolbar-spacer" />
          <button type="button" className="button ghost" onClick={onClose}>
            Later
          </button>
          <button type="button" className="button" onClick={save} disabled={busy || !chosen.length}>
            {busy ? 'Saving…' : `Save ${chosen.length} link${chosen.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <p className="muted small">
        Linked ingredients are costed, taken from the pantry and put on the shopping list as that item — whatever the recipe calls them.
        Suggestions are filled in; change any, or clear one to leave it for now. A name that isn't an item yet becomes a new item.
      </p>
      {error && <p className="error">{error}</p>}
      <datalist id="link-items">
        {catalog.map((i) => (
          <option key={i.id} value={i.name} />
        ))}
      </datalist>
      <ul className="link-review">
        {todo.map((i) => {
          const p = picks[i.id];
          const isNew = p.name.trim() && !byName.has(p.name.trim().toLowerCase());
          return (
            <li key={i.id} className={p.skip ? 'off' : ''}>
              <span className="link-ing">
                <strong>{i.name}</strong>
                {i.note && <span className="muted tiny"> · {i.note}</span>}
              </span>
              <span className="link-pick">
                <input
                  list="link-items"
                  value={p.name}
                  disabled={p.skip}
                  onChange={(e) => set(i.id, { name: e.target.value })}
                  placeholder="Item…"
                  aria-label={`Item for ${i.name}`}
                />
                {isNew && !p.skip && <span className="tiny muted">new item</span>}
                <label className="tiny muted nowrap">
                  <input type="checkbox" checked={p.skip} onChange={(e) => set(i.id, { skip: e.target.checked })} /> don't link
                </label>
              </span>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
