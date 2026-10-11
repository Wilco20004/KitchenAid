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

/** "2 × 500 g" → "1 kg"; loose produce is what the bag weighed. */
function total(l: SlipLine, d: Draft): string | null {
  const q = Number(d.qty.replace(',', '.'));
  if (!d.unit || !(q > 0)) return null;
  const count = l.pack.from === 'loose' ? 1 : l.quantity;
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

  // One save for both choices: Pantry lines go in, Remove lines leave the sheet.
  async function save() {
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
      const removeIds = lines.filter((l) => !drafts[l.id]?.on).map((l) => l.id);
      const r = payload.length ? await api.acceptSlipLines(payload) : { results: [] };
      if (removeIds.length) await api.skipSlipLines(removeIds);
      setDone({ added: r.results.length, skipped: removeIds.length, ticked: r.results.reduce((n, x) => n + x.ticked, 0) });
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const setSlip = (slip: PendingSlip, on: boolean) =>
    setDrafts((d) => ({ ...d, ...Object.fromEntries(slip.lines.map((l) => [l.id, { ...d[l.id], on }])) }));

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
          {done.ticked ? `, ${done.ticked} ticked off the shopping list` : ''}
          {done.skipped ? `, ${done.skipped} removed` : ''}.{done.added ? ' Pack sizes you gave are remembered for next time.' : ''}
        </p>
      </Modal>
    );
  }

  const removing = lines.length - ticked.length;
  return (
    <Modal
      title="Check new slips"
      onClose={onClose}
      footer={
        <>
          <span className="muted small">
            {ticked.length} to the pantry{removing ? ` · ${removing} removed` : ''}
          </span>
          <span className="toolbar-spacer" />
          <button type="button" className="button" onClick={save} disabled={busy || !lines.length}>
            {busy ? 'Saving…' : 'Save'}
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
            Every line is <strong>Pantry</strong> or <strong>Remove</strong>. For pantry lines say what each is and what <strong>one</strong> pack
            holds (a 500 g brick, 1 tin, 24 cubes) — it's remembered, so next time these are filled in already. For loose produce (BANANA KG)
            give what the bag weighed, or how many. <strong>Remove</strong> anything that isn't for the pantry (a milk tart, a baking tray):
            it leaves the sheet, and its price is still kept.
          </p>
          <datalist id="slip-items">
            {catalog.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
          {slips.map((s) => (
            <section key={s.receipt_id} className="slip">
              <div className="slip-head">
                <h3>
                  {s.store ?? 'Slip'} <span className="muted small">· {s.bought_at}</span>
                </h3>
                <span className="slip-all">
                  <button type="button" className="text-button tiny" onClick={() => setSlip(s, true)}>
                    all pantry
                  </button>
                  <button type="button" className="text-button tiny" onClick={() => setSlip(s, false)}>
                    remove all
                  </button>
                </span>
              </div>
              <ul className="slip-lines">
                {s.lines.map((l) => {
                  const d = drafts[l.id];
                  if (!d) return null;
                  const t = total(l, d);
                  return (
                    <li key={l.id} className={`${d.on ? '' : 'off'}${l.pack.from === 'guess' && d.unit === draftOf(l).unit ? ' guess' : ''}`}>
                      <div className="slip-raw">
                        <span className="segmented slip-choice" role="group" aria-label={`${l.raw_name}: pantry or remove`}>
                          <button type="button" className={d.on ? 'active' : ''} aria-pressed={d.on} onClick={() => set(l.id, { on: true })}>
                            Pantry
                          </button>
                          <button type="button" className={!d.on ? 'active remove' : ''} aria-pressed={!d.on} onClick={() => set(l.id, { on: false })}>
                            Remove
                          </button>
                        </span>
                        <span>
                          <strong>{l.raw_name}</strong>
                          <span className="muted tiny">
                            {' '}
                            {l.quantity !== 1 ? `${l.quantity} × ` : ''}
                            {rand(l.amount / (l.quantity || 1))}
                          </span>
                        </span>
                      </div>
                      {d.on && (
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
                              onChange={(e) => set(l.id, { qty: e.target.value, unit: d.unit || (l.pack.from === 'loose' ? 'kg' : 'piece') })}
                              aria-label={l.pack.from === 'loose' ? 'The bag weighed' : 'One pack holds'}
                              placeholder={l.pack.from === 'loose' ? 'weight' : '—'}
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
                            {l.pack.from === 'loose' && !t ? ' · loose: weight or count?' : ''}
                            {l.pack.from === 'remembered' ? ' ✓' : l.pack.from === 'guess' && d.qty === draftOf(l).qty && d.unit === draftOf(l).unit ? ' · check' : ''}
                          </span>
                        </div>
                      )}
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
