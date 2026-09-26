import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { CookPlan, UseResult } from '../types';
import Modal from './Modal';

/**
 * "I cooked this": what the recipe took from the pantry, to check before it
 * comes off. Amounts can be changed; things at home without an amount start
 * unticked and, when ticked, count as used up.
 */
export default function CookDialog({
  recipeId,
  servings,
  onClose,
  onDone,
}: {
  recipeId: string;
  servings: number | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [plan, setPlan] = useState<CookPlan | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [amounts, setAmounts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UseResult[] | null>(null);

  useEffect(() => {
    api
      .cookPlan(recipeId, servings)
      .then((p) => {
        setPlan(p);
        setAmounts(p.lines.map((l) => l.use_text));
        setChecked(new Set(p.lines.map((l, i) => (l.action === 'unknown' ? -1 : i)).filter((i) => i >= 0)));
      })
      .catch((e) => setError(e.message));
  }, [recipeId, servings]);

  function toggle(i: number) {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const lines = plan.lines
        .map((l, i) => ({ l, i }))
        .filter(({ i }) => checked.has(i))
        .map(({ l, i }) => (l.action === 'unknown' ? { item_id: l.item_id, used_up: true } : { item_id: l.item_id, amount: amounts[i] }));
      const r = await api.cooked(recipeId, lines);
      setResults(r.results);
      onDone?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (results) {
    return (
      <Modal
        title="Pantry updated"
        onClose={onClose}
        footer={
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
        }
      >
        {results.length === 0 ? (
          <p className="muted">Nothing was taken out.</p>
        ) : (
          <ul className="use-results">
            {results.map((r, i) => (
              <li key={i}>
                <strong>{r.item}</strong>{' '}
                <span className={r.skipped ? 'muted' : ''}>
                  {r.skipped ? `— unchanged (${r.skipped})` : r.removed ? '— used up, out of the pantry' : `— ${r.left} left`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={`Cooked${plan ? ` ${plan.recipe}` : ''}`}
      onClose={onClose}
      footer={
        <button type="button" className="button" onClick={apply} disabled={busy || !plan || !checked.size}>
          {busy ? 'Updating…' : `Take ${checked.size} out of the pantry`}
        </button>
      }
    >
      {error && <p className="error">{error}</p>}
      {plan === null ? (
        !error && <p className="muted">Checking the pantry…</p>
      ) : plan.lines.length === 0 ? (
        <p className="muted">None of this recipe's ingredients are in the pantry, so there's nothing to take out.</p>
      ) : (
        <>
          <p className="muted small">
            For {plan.servings ?? 'the recipe’s'} serving{plan.servings === 1 ? '' : 's'}. Change an amount if you used more or less.
          </p>
          <ul className="check-list cook-list">
            {plan.lines.map((l, i) => {
              const edited = amounts[i] !== l.use_text;
              return (
                <li key={l.item_id}>
                  <label className={checked.has(i) ? '' : 'off'}>
                    <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                    <span className="check-list-main">
                      <span>
                        <strong>{l.item}</strong>
                        {l.have && <span className="muted tiny"> · {l.have} at home</span>}
                      </span>
                      <span className="muted tiny">
                        {l.action === 'unknown'
                          ? l.have
                            ? `recipe uses ${l.use_text || 'some'} — can't take that off ${l.have}; tick if it's finished`
                            : 'no amount recorded at home — tick if it’s finished'
                          : edited
                            ? 'worked out when you confirm'
                            : l.action === 'use_up'
                              ? 'finishes it'
                              : `${l.left_text} left${l.approx ? ' (about)' : ''}`}
                      </span>
                    </span>
                  </label>
                  {l.action !== 'unknown' && (
                    <input
                      className="cook-amount"
                      value={amounts[i] ?? ''}
                      onChange={(e) => setAmounts((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
                      aria-label={`Amount of ${l.item} used`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {plan && plan.not_at_home.length > 0 && (
        <p className="hint">Not in the pantry, so left alone: {plan.not_at_home.join(', ')}.</p>
      )}
    </Modal>
  );
}
