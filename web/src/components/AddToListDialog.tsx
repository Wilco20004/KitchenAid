import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { PreviewLine, ShoppingList } from '../types';
import { formatAmount } from '../utils/format';
import Modal from './Modal';

/**
 * Review step before ingredients go on the shopping list: everything starts
 * ticked except pantry staples, so you just untick what's already in the cupboard.
 */
export default function AddToListDialog({
  title,
  load,
  onClose,
}: {
  title: string;
  load: () => Promise<PreviewLine[]>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [lines, setLines] = useState<PreviewLine[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [listId, setListId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    load()
      .then((l) => {
        setLines(l);
        setSelected(new Set(l.map((line, i) => (line.staple || line.in_pantry ? -1 : i)).filter((i) => i >= 0)));
      })
      .catch((e) => setError(e.message));
    api
      .listShoppingLists()
      .then((ls) => {
        setLists(ls);
        setListId(ls[0]?.id ?? '');
      })
      .catch((e) => setError(e.message));
  }, [load]);

  function toggle(i: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function add() {
    if (!lines || !listId) return;
    setBusy(true);
    setError(null);
    try {
      const items = lines
        .filter((_l, i) => selected.has(i))
        .map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit, source: l.sources.join(' · ') }));
      const res = await api.addItemsBulk(listId, items);
      setDone(res.added);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <Modal
        title="Added"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="button secondary" onClick={onClose}>
              Done
            </button>
            <button type="button" className="button" onClick={() => navigate('/shopping')}>
              Open shopping list
            </button>
          </>
        }
      >
        <p>
          {done} item{done === 1 ? '' : 's'} added to <strong>{lists.find((l) => l.id === listId)?.name}</strong>. Anything already on
          the list was topped up rather than added twice.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {lists.length > 1 && (
            <select value={listId} onChange={(e) => setListId(e.target.value)} className="grow-mobile" aria-label="Shopping list">
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="button" onClick={add} disabled={busy || !selected.size}>
            {busy ? 'Adding…' : `Add ${selected.size} item${selected.size === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      {error && <p className="error">{error}</p>}
      {lines === null ? (
        <p className="muted">Working out what you need…</p>
      ) : lines.length === 0 ? (
        <p className="muted">No ingredients to add — plan some recipes (not just notes) first.</p>
      ) : (
        <>
          <div className="row-between small">
            <span className="muted">Things at home start unticked — untick anything else you have.</span>
            <span className="link-buttons">
              <button type="button" className="link" onClick={() => setSelected(new Set(lines.map((_l, i) => i)))}>
                All
              </button>
              <button type="button" className="link" onClick={() => setSelected(new Set())}>
                None
              </button>
            </span>
          </div>
          <ul className="check-list">
            {lines.map((l, i) => (
              <li key={i}>
                <label className={selected.has(i) ? '' : 'off'}>
                  <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                  <span className="check-list-main">
                    <span>
                      {l.quantity !== null || l.unit ? <strong>{formatAmount(l.quantity, l.unit)} </strong> : null}
                      {l.name}
                      {l.staple ? <span className="pill tiny">staple</span> : l.in_pantry ? <span className="pill tiny">at home</span> : null}
                    </span>
                    {l.sources.length > 1 && <span className="muted tiny">{l.sources.join(' · ')}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
