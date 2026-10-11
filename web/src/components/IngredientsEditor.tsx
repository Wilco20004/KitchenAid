import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { Ingredient, IngredientInput, Item, ParsedIngredient } from '../types';
import { formatQuantity } from '../utils/format';
import Icon from './Icon';

// Ingredients as rows: amount, unit, name and a note, each linked to the
// catalogue item it is — so costing, the pantry and the shopping list go by
// the link instead of hoping the spelling matches. A linked row shows its
// item's short name ({{flour}}) for live amounts in the method; short names
// are set on the item (Pantry), not here.

const UNITS = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'piece', 'clove', 'tin', 'can', 'packet', 'sachet', 'pinch', 'bunch', 'slice', 'jar', 'bottle'];

// Plain keys, no crypto: crypto.randomUUID is missing over plain http on the LAN.
let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type IngRow = {
  key: string;
  kind: 'ing';
  amount: string;
  unit: string;
  name: string;
  note: string;
  /** Item name typed or picked; linkId is set when it's an existing item. */
  link: string;
  linkId: string | null;
  noLink: boolean;
  suggested: { id: string; name: string } | null;
};
export type SectionRow = { key: string; kind: 'section'; title: string };
export type Row = IngRow | SectionRow;

const amountOf = (q: number | null, max: number | null, unit: string | null) =>
  q === null ? '' : `${formatQuantity(q, unit)}${max !== null ? `–${formatQuantity(max, unit)}` : ''}`;

function ingRow(i: Pick<Ingredient, 'quantity' | 'quantity_max' | 'unit' | 'name' | 'note' | 'suggested'> & Partial<Ingredient>): IngRow {
  return {
    key: newKey(),
    kind: 'ing',
    amount: amountOf(i.quantity, i.quantity_max, i.unit),
    unit: i.unit ?? '',
    name: i.name,
    note: i.note ?? '',
    link: i.item?.name ?? '',
    linkId: i.item?.id ?? null,
    noLink: Boolean(i.no_link),
    suggested: i.suggested ?? null,
  };
}

/** Rows (with section headings) from a saved recipe's ingredients. */
export function rowsFromIngredients(ings: Ingredient[]): Row[] {
  const rows: Row[] = [];
  let section: string | null = null;
  for (const i of ings) {
    if (i.section !== section) {
      if (i.section) rows.push({ key: newKey(), kind: 'section', title: i.section });
      section = i.section;
    }
    rows.push(ingRow(i));
  }
  return rows;
}

/** Rows from pasted lines the server has read. */
export function rowsFromParsed(parsed: ParsedIngredient[], section: string | null = null): Row[] {
  const rows: Row[] = [];
  for (const p of parsed) {
    if (p.section !== section) {
      if (p.section) rows.push({ key: newKey(), kind: 'section', title: p.section });
      section = p.section;
    }
    rows.push(ingRow({ ...p, item: null, no_link: false }));
  }
  return rows;
}

/** Lines of text, with "Heading:" lines starting a section — the paste box's format. */
export function linesFromText(text: string): { section: string | null; raw: string }[] {
  let section: string | null = null;
  const out: { section: string | null; raw: string }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[^\d].{0,48}:$/.test(line)) {
      section = line.slice(0, -1).trim() || null;
      continue;
    }
    out.push({ section, raw: line });
  }
  return out;
}

/** What gets saved. */
export function ingredientsFromRows(rows: Row[], catalog: Item[]): IngredientInput[] {
  const byName = new Map(catalog.map((i) => [i.name.trim().toLowerCase(), i.id]));
  let section: string | null = null;
  const out: IngredientInput[] = [];
  for (const r of rows) {
    if (r.kind === 'section') {
      section = r.title.trim() || null;
      continue;
    }
    if (!r.name.trim()) continue;
    const link = r.link.trim();
    const linkId = r.linkId ?? (link ? byName.get(link.toLowerCase()) ?? null : null);
    out.push({
      section,
      amount: r.amount,
      unit: r.unit.trim() || null,
      name: r.name.trim(),
      note: r.note.trim() || null,
      ...(linkId ? { item_id: linkId } : link ? { item_name: link } : { no_link: r.noLink }),
    });
  }
  return out;
}

export default function IngredientsEditor({
  rows,
  setRows,
  catalog,
}: {
  rows: Row[];
  setRows: (update: (rows: Row[]) => Row[]) => void;
  catalog: Item[];
}) {
  const [paste, setPaste] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byName = useMemo(() => new Map(catalog.map((i) => [i.name.trim().toLowerCase(), i])), [catalog]);
  const byId = useMemo(() => new Map(catalog.map((i) => [i.id, i])), [catalog]);
  const unlinked = rows.filter((r): r is IngRow => r.kind === 'ing' && !!r.name.trim() && !r.link.trim() && !r.noLink);

  const set = (key: string, patch: Partial<IngRow> | Partial<SectionRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? ({ ...r, ...patch } as Row) : r)));
  const remove = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));
  const move = (key: string, by: -1 | 1) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const j = i + by;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function addRow() {
    setRows((rs) => [...rs, { ...ingRow({ quantity: null, quantity_max: null, unit: null, name: '', note: null, suggested: null }) }]);
  }

  function setLink(row: IngRow, text: string) {
    const hit = byName.get(text.trim().toLowerCase());
    set(row.key, { link: text, linkId: hit?.id ?? null, noLink: false });
  }

  async function addPasted() {
    const lines = linesFromText(paste ?? '');
    if (!lines.length) return setPaste(null);
    setBusy(true);
    setError(null);
    try {
      const parsed = await api.parseIngredients(lines);
      setRows((rs) => [...rs.filter((r) => r.kind === 'section' || r.name.trim() || r.amount.trim()), ...rowsFromParsed(parsed)]);
      setPaste(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function acceptAllSuggestions() {
    setRows((rs) => rs.map((r) => (r.kind === 'ing' && !r.link.trim() && !r.noLink && r.suggested ? { ...r, link: r.suggested.name, linkId: r.suggested.id } : r)));
  }

  const suggestedCount = unlinked.filter((r) => r.suggested).length;

  return (
    <div className="ing-editor">
      <datalist id="ing-items">
        {catalog.map((i) => (
          <option key={i.id} value={i.name} />
        ))}
      </datalist>
      <datalist id="ing-units">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {unlinked.length > 0 && (
        <p className="notice warn small ing-unlinked">
          {unlinked.length} ingredient{unlinked.length === 1 ? ' isn’t' : 's aren’t'} linked to an item yet — they're matched by name, which can
          drift.
          {suggestedCount > 0 && (
            <>
              {' '}
              <button type="button" className="button secondary small" onClick={acceptAllSuggestions}>
                Use {suggestedCount} suggestion{suggestedCount === 1 ? '' : 's'}
              </button>
            </>
          )}
        </p>
      )}

      {rows.length === 0 && <p className="muted small">No ingredients yet — add them one by one, or paste a list.</p>}

      <ol className="ing-rows">
        {rows.map((r, idx) =>
          r.kind === 'section' ? (
            <li key={r.key} className="ing-section">
              <input value={r.title} onChange={(e) => set(r.key, { title: e.target.value })} placeholder="Section, e.g. For the sauce" aria-label="Section heading" />
              <RowTools onUp={idx > 0 ? () => move(r.key, -1) : undefined} onDown={idx < rows.length - 1 ? () => move(r.key, 1) : undefined} onRemove={() => remove(r.key)} />
            </li>
          ) : (
            <li key={r.key} className="ing-row">
              <div className="ing-main">
                <input className="ing-amount" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })} placeholder="1¾" aria-label="Amount" inputMode="text" />
                <input className="ing-unit" list="ing-units" value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} placeholder="unit" aria-label="Unit" />
                <input
                  className="ing-name"
                  value={r.name}
                  onChange={(e) => set(r.key, { name: e.target.value })}
                  placeholder="Ingredient"
                  aria-label="Ingredient"
                />
                <input className="ing-note" value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} placeholder="Note — sifted, at room temperature…" aria-label="Note" />
                <RowTools onUp={idx > 0 ? () => move(r.key, -1) : undefined} onDown={idx < rows.length - 1 ? () => move(r.key, 1) : undefined} onRemove={() => remove(r.key)} />
              </div>
              <div className="ing-meta">
                <span className={`ing-link${r.linkId ? ' linked' : r.link.trim() ? ' new' : r.noLink ? ' off' : ''}`}>
                  <Icon name="link" size={14} />
                  {r.noLink ? (
                    <span className="muted tiny">
                      Not linked{' '}
                      <button type="button" className="text-button" onClick={() => set(r.key, { noLink: false })}>
                        link it
                      </button>
                    </span>
                  ) : (
                    <>
                      <input list="ing-items" value={r.link} onChange={(e) => setLink(r, e.target.value)} placeholder="Link to item…" aria-label={`Item for ${r.name || 'ingredient'}`} />
                      {r.link.trim() && !r.linkId && <span className="tiny muted">new item</span>}
                      {!r.link.trim() && r.suggested && (
                        <button type="button" className="chip small suggest" onClick={() => set(r.key, { link: r.suggested!.name, linkId: r.suggested!.id })} title="Link to this item">
                          {r.suggested.name}?
                        </button>
                      )}
                      {!r.link.trim() && (
                        <button type="button" className="text-button tiny" onClick={() => set(r.key, { noLink: true })} title="Never link this (water, ice…)">
                          don't link
                        </button>
                      )}
                    </>
                  )}
                </span>
                {r.linkId && byId.get(r.linkId)?.ref ? (
                  <code className="ing-ref" title="This item's short name for amounts in the method — change it on the item in Pantry">
                    {`{{${byId.get(r.linkId)!.ref}}}`}
                  </code>
                ) : r.link.trim() && !r.linkId ? (
                  <span className="ing-ref muted tiny" title="New items get a short name when the recipe is saved">
                    {'{{…}}'} after saving
                  </span>
                ) : null}
              </div>
            </li>
          )
        )}
      </ol>

      {paste !== null ? (
        <div className="ing-paste">
          <textarea
            rows={8}
            autoFocus
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={'500 g beef mince\n1 large onion, chopped\n\nTopping:\n2 eggs\n250 ml milk'}
          />
          <span className="hint">One per line. A line ending in “:” starts a section.</span>
          {error && <p className="error small">{error}</p>}
          <div className="row-gap">
            <button type="button" className="button small" onClick={addPasted} disabled={busy}>
              {busy ? 'Reading…' : 'Add these'}
            </button>
            <button type="button" className="button ghost small" onClick={() => setPaste(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row-gap">
          <button type="button" className="button secondary small" onClick={addRow}>
            <Icon name="plus" size={16} /> Ingredient
          </button>
          <button type="button" className="button ghost small" onClick={() => setRows((rs) => [...rs, { key: newKey(), kind: 'section', title: '' }])}>
            <Icon name="plus" size={16} /> Section
          </button>
          <button type="button" className="button ghost small" onClick={() => setPaste('')}>
            Paste a list
          </button>
        </div>
      )}
    </div>
  );
}

function RowTools({ onUp, onDown, onRemove }: { onUp?: () => void; onDown?: () => void; onRemove: () => void }) {
  return (
    <span className="row-tools">
      <button type="button" className="icon-button small" onClick={onUp} disabled={!onUp} aria-label="Move up" title="Move up">
        <Icon name="up" size={16} />
      </button>
      <button type="button" className="icon-button small" onClick={onDown} disabled={!onDown} aria-label="Move down" title="Move down">
        <Icon name="down" size={16} />
      </button>
      <button type="button" className="icon-button small danger" onClick={onRemove} aria-label="Remove" title="Remove">
        <Icon name="x" size={16} />
      </button>
    </span>
  );
}
