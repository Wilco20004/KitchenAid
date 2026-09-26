import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Item, PendingSlip, SlipLine } from '../types';
import { formatAmount, rand } from '../utils/format';
import Modal from './Modal';

// What one pack can be. "" = no amount, just "at home".
const UNITS = ['g', 'kg', 'ml', 'l', 'piece', 'packet', 'tin', 'sachet', 'jar', 'bottle', 'bag', 'box', 'tub'];

interface Draft {
  on: boolean;
  item: string;
  qty: string;
  unit: string;
}

const draftOf = (l: SlipLine): Draft => ({
  on: true,
  item: l.item?.name ?? '',
  qty: l.pack.quantity !== null ? String(l.pack.quantity) : '',
  unit: l.pack.quantity !== null ? l.pack.unit ?? 'piece' : '',
});

/** "2 × 500 g" → "1 kg"; loose produce by weight is its kilos. */
function total(l: SlipLine, d: Draft): string | null {
  const q = Number(d.qty.replace(',', '.'));
  if (!d.unit || !(q > 0)) return null;
  const count = l.pack.from === 'loose' && d.unit === 'kg' ? l.quantity / q : l.quantity;
  let amount = Math.round(count * q * 1000) / 1000;
  let unit = d.unit;
  if (unit === 'g' && amount >= 1000) [amount, unit] = [amount / 1000, 'kg'];
  if (unit === 'ml' && amount >= 1000) [amount, unit] = [amount / 1000, 'l'];
  return formatAmount(amount, unit === 'piece' ? null : unit);
}

/**
 * The slip review sheet: new slip lines wait here until you say which item
 * each is and what one pack holds (2 × BONNITA BUTTER = 2 × 500 g). Answers
 * are remembered, so the same lines next time are already filled in.
 */
export default function SlipReview({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [slips, setSlips] = useState<PendingSlip[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ added: number; skipped: number; ticked: number } | null>(null);

  useEffect(() => {
    api
      .pendingSlips()
      .then((r) => {
        setSlips(r.slips);
        setDrafts(Object.fromEntries(r.slips.flatMap((s) => s.lines.map((l) => [l.id, draftOf(l)]))));
      })
      .catch((e) => setError(e.message));
    api.listCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  const byName = useMemo(() => new Map(catalog.map((i) => [i.name.trim().toLowerCase(), i])), [catalog]);
  const lines = useMemo(() => (slips ?? []).flatMap((s) => s.lines), [slips]);
  const ticked = lines.filter((l) => drafts[l.id]?.on);

  const set = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const payload = ticked.map((l) => {
        const d = drafts[l.id];
        const name = d.item.trim();
        const existing = byName.get(name.toLowerCase());
        const q = Number(d.qty.replace(',', '.'));
        return {
          id: l.id,
          ...(name && name !== l.item?.name ? (existing ? { item_id: existing.id } : { item_name: name }) : {}),
          pack_quantity: d.unit && q > 0 ? q : null,
          pack_unit: d.unit && q > 0 ? d.unit : null,
        };
      });
      const r = payload.length ? await api.acceptSlipLines(payload) : { results: [] };
      setDone({ added: r.results.length, skipped: 0, ticked: r.results.reduce((n, x) => n + x.ticked, 0) });
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function skipUnticked() {
    const ids = lines.filter((l) => !drafts[l.id]?.on).map((l) => l.id);
    if (!ids.length) return;
    if (!confirm(`Leave ${ids.length} unticked line${ids.length === 1 ? '' : 's'} out of the pantry for good?`)) return;
    setBusy(true);
    try {
      await api.skipSlipLines(ids);
      setSlips((s) => (s ?? []).map((x) => ({ ...x, lines: x.lines.filter((l) => !ids.includes(l.id)) })).filter((x) => x.lines.length));
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal
        title="Into the pantry"
        onClose={onClose}
        footer={
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
        }
      >
        <p>
          {done.added} line{done.added === 1 ? '' : 's'} added to the pantry
          {done.ticked ? `, ${done.ticked} ticked off the shopping list` : ''}. Pack sizes you gave are remembered for next time.
        </p>
      </Modal>
    );
  }

  const unticked = lines.length - ticked.length;
  return (
    <Modal
      title="Check new slips"
      onClose={onClose}
      footer={
        <>
          {unticked > 0 && (
            <button type="button" className="button ghost" onClick={skipUnticked} disabled={busy}>
              Skip {unticked} unticked
            </button>
          )}
          <span className="toolbar-spacer" />
          <button type="button" className="button" onClick={accept} disabled={busy || !ticked.length}>
            {busy ? 'Adding…' : `Add ${ticked.length} to the pantry`}
          </button>
        </>
      }
    >
      {error && <p className="error">{error}</p>}
      {slips === null ? (
        !error && <p className="muted">Loading slips…</p>
      ) : lines.length === 0 ? (
        <p className="muted">Nothing to check — new BudgetPro slips land here before they go into the pantry.</p>
      ) : (
        <>
          <p className="muted small">
            Say what each line is and what <strong>one</strong> pack holds (a 500 g brick, 1 tin, 24 cubes). It's remembered, so next time these are
            filled in already. Untick anything that isn't for the pantry.
          </p>
          <datalist id="slip-items">
            {catalog.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
          {slips.map((s) => (
            <section key={s.receipt_id} className="slip">
              <h3>
                {s.store ?? 'Slip'} <span className="muted small">· {s.bought_at}</span>
              </h3>
              <ul className="slip-lines">
                {s.lines.map((l) => {
                  const d = drafts[l.id];
                  if (!d) return null;
                  const t = total(l, d);
                  return (
                    <li key={l.id} className={`${d.on ? '' : 'off'}${l.pack.from === 'guess' && d.unit === draftOf(l).unit ? ' guess' : ''}`}>
                      <label className="slip-raw">
                        <input type="checkbox" checked={d.on} onChange={() => set(l.id, { on: !d.on })} />
                        <span>
                          <strong>{l.raw_name}</strong>
                          <span className="muted tiny">
                            {' '}
                            {l.quantity !== 1 ? `${l.quantity} × ` : ''}
                            {rand(l.amount / (l.quantity || 1))}
                          </span>
                        </span>
                      </label>
                      <div className="slip-fields">
                        <input
                          list="slip-items"
                          value={d.item}
                          onChange={(e) => set(l.id, { item: e.target.value })}
                          aria-label={`Item for ${l.raw_name}`}
                          placeholder="Item"
                        />
                        <span className="slip-pack">
                          <input
                            inputMode="decimal"
                            value={d.qty}
                            onChange={(e) => set(l.id, { qty: e.target.value, unit: d.unit || 'piece' })}
                            aria-label="One pack holds"
                            placeholder="—"
                          />
                          <select value={d.unit} onChange={(e) => set(l.id, { unit: e.target.value, qty: e.target.value ? d.qty || '1' : '' })} aria-label="Unit">
                            <option value="">no amount</option>
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </span>
                        <span className="muted tiny slip-total">
                          {t ? `→ ${t}` : '→ at home'}
                          {l.pack.from === 'remembered' ? ' ✓' : l.pack.from === 'guess' && d.qty === draftOf(l).qty && d.unit === draftOf(l).unit ? ' · check' : ''}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </Modal>
  );
}
