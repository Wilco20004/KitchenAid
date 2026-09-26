import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { RecipeCost } from '../types';
import { rand } from '../utils/format';

// Recipe cost from prices actually paid (BudgetPro slips / set by hand):
// only the amount used — 2 eggs at R4 each is R8, not the R72 tray.
export default function RecipeCostPanel({ recipeId, servings }: { recipeId: string; servings: number }) {
  const [cost, setCost] = useState<RecipeCost | null>(null);
  const [store, setStore] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .recipeCost(recipeId, servings, store)
        .then(setCost)
        .catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [recipeId, servings, store]);

  if (error) return <p className="error small">{error}</p>;
  if (!cost) return null;
  const total = cost.priced + cost.unpriced;

  return (
    <div className="cost-panel">
      <button type="button" className="cost-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>
          <span className="muted tiny">Cost to make</span>
          <strong className="cost-total">{cost.priced ? rand(cost.total) : '—'}</strong>
          {cost.per_serving !== null && cost.priced > 0 && <span className="muted small"> · {rand(cost.per_serving)} a serving</span>}
        </span>
        <span className="muted tiny">
          {cost.priced} of {total} priced {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="cost-breakdown">
          <ul>
            {cost.lines.map((l, i) => (
              <li key={i} className={l.cost === null ? 'unpriced' : ''}>
                <span className="cost-line-name">{l.raw}</span>
                <span className="cost-line-amount">
                  {l.cost !== null ? rand(l.cost) : '—'}
                  {l.basis === 'store' && <span className="pill tiny">shop price</span>}
                  {l.approx && <span className="pill tiny">approx</span>}
                </span>
                <span className="muted tiny cost-line-detail">{l.detail}</span>
              </li>
            ))}
          </ul>
          <label className="check small">
            <input type="checkbox" checked={store} onChange={(e) => setStore(e.target.checked)} /> Fill gaps with today's shop prices (when
            already looked up)
          </label>
          <p className="muted tiny">
            Prices come from what you paid (BudgetPro slips, or set on the item in the Pantry). Only the amount used is counted.
          </p>
        </div>
      )}
    </div>
  );
}
