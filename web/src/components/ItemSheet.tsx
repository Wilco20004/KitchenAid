import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Category, Item, ItemAlias, ItemDetail } from '../types';
import { expiryLabel, formatAmount, pantryAmount, rand, unitPriceLabel } from '../utils/format';
import Modal from './Modal';
import Icon from './Icon';
import BarcodeScanner from './BarcodeScanner';
import { sanitizeRef } from '../utils/steps';

const KIND_LABEL: Record<ItemAlias['kind'], string> = {
  barcode: 'Barcode',
  name: 'Also called',
  slip: 'On slips as',
  store: 'Shop product',
};

// Quick picks for "keeps for": fridge, a week, a month, freezer.
const KEEPS_PRESETS: [string, number][] = [
  ['3 days', 3],
  ['1 week', 7],
  ['1 month', 30],
  ['3 months', 90],
  ['6 months', 180],
];

const SOURCE_LABEL: Record<string, string> = {
  budgetpro: 'from a BudgetPro slip',
  shopping: 'ticked off the shopping list',
  manual: 'added by hand',
  ai: 'added by the AI assistant',
  slip: 'BudgetPro slip',
};

/**
 * Everything about one item: at home or not, what it last cost, and every
 * barcode / slip spelling / other name linked to it — plus merging two items
 * that are really the same thing (Knorr vs Royco onion soup).
 */
export default function ItemSheet({
  itemId,
  onClose,
  onChanged,
  categories,
}: {
  itemId: string;
  onClose: () => void;
  onChanged: () => void;
  categories: Category[];
}) {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [containers, setContainers] = useState<string[]>([]);
  const [sizeQty, setSizeQty] = useState('');
  // Fixing what's at home: null when not editing.
  const [amountEdit, setAmountEdit] = useState<{ quantity: string; unit: string } | null>(null);
  const [pricing, setPricing] = useState(false);
  const [packPrice, setPackPrice] = useState('');
  const [packLabel, setPackLabel] = useState('');
  // The size of the pack being priced, when the item has a usual one: starts
  // at that size, changed for the odd 500 ml bottle.
  const [priceSize, setPriceSize] = useState<{ quantity: string; unit: string }>({ quantity: '', unit: 'ml' });
  const [newName, setNewName] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [merging, setMerging] = useState(false);
  const [keeps, setKeeps] = useState('');
  const [useAmount, setUseAmount] = useState('');
  const [useMsg, setUseMsg] = useState<string | null>(null);

  useEffect(() => {
    api.containers().then(setContainers).catch(() => setContainers([]));
  }, []);

  useEffect(() => {
    api
      .getCatalogItem(itemId)
      .then((i) => {
        setItem(i);
        setName(i.name);
        setRef(i.ref ?? '');
        setSizeQty(i.size_quantity?.toString() ?? '');
        setKeeps(i.keeps_days?.toString() ?? '');
      })
      .catch((e) => setError(e.message));
  }, [itemId]);

  async function run(fn: () => Promise<ItemDetail | Item | void>) {
    setError(null);
    try {
      await fn();
      const fresh = await api.getCatalogItem(itemId);
      setItem(fresh);
      setName(fresh.name);
      setRef(fresh.ref ?? '');
      setSizeQty(fresh.size_quantity?.toString() ?? '');
      setKeeps(fresh.keeps_days?.toString() ?? '');
      onChanged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (!item) {
    return (
      <Modal title="Item" onClose={onClose}>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </Modal>
    );
  }

  const price = unitPriceLabel(item.unit_price, item.price_unit);
  const groups = (['barcode', 'name', 'slip', 'store'] as const)
    .map((kind) => ({ kind, rows: item.aliases.filter((a) => a.kind === kind) }))
    .filter((g) => g.rows.length);

  function addName(e: FormEvent) {
    e.preventDefault();
    if (newName.trim()) run(() => api.addAlias(item!.id, 'name', newName.trim())).then(() => setNewName(''));
  }

  function addBarcode(code: string) {
    const c = code.replace(/\s+/g, '');
    if (c) run(() => api.addAlias(item!.id, 'barcode', c)).then(() => setNewBarcode(''));
  }

  // The short name recipe steps use for this item: {{flour}}. The server
  // rewrites the steps of recipes using the old one.
  function saveRef() {
    const next = ref.replace(/-+$/, '');
    if (!next) return setRef(item!.ref ?? '');
    if (next !== item!.ref) run(() => api.updateCatalogItem(item!.id, { ref: next }));
  }

  function saveSize(patch: { container?: string | null; size_quantity?: number | null; size_unit?: string | null }) {
    run(() => api.setItemSize(item!.id, patch));
  }

  function saveSizeQty() {
    const q = sizeQty.trim() ? Number(sizeQty.replace(',', '.')) : null;
    if (q === item!.size_quantity) return;
    if (q !== null && !(q > 0)) return setError('The size must be a number, e.g. 750');
    saveSize({ size_quantity: q, size_unit: q === null ? null : item!.size_unit ?? (item!.container ? 'ml' : 'g') });
  }

  function saveAmount(e: FormEvent) {
    e.preventDefault();
    if (!amountEdit) return;
    const q = amountEdit.quantity.trim() ? Number(amountEdit.quantity.replace(',', '.')) : null;
    if (q !== null && !(q > 0)) return setError('The amount must be a number');
    run(() => api.setPantryAmount(item!.id, { quantity: q, unit: q === null ? null : amountEdit.unit || null })).then(() => setAmountEdit(null));
  }

  function saveKeeps(value: string) {
    const days = value.trim() ? Number(value) : null;
    if (days === item!.keeps_days) return;
    if (days !== null && !(Number.isInteger(days) && days > 0)) {
      setError('Keeps for must be a whole number of days');
      return;
    }
    run(() => api.setExpiry(item!.id, { keeps_days: days }));
  }

  const expiry = item.in_pantry && item.expires_at ? expiryLabel(item.expires_at) : null;

  function useSome(e: FormEvent) {
    e.preventDefault();
    if (!useAmount.trim()) return;
    setUseMsg(null);
    run(async () => {
      const r = await api.useSome(item!.id, { amount: useAmount.trim() });
      setUseAmount('');
      setUseMsg(r.result.skipped ? `Unchanged — ${r.result.skipped}` : r.result.removed ? 'All used — out of the pantry' : `${r.result.left} left`);
    });
  }

  // Items with a "Comes in" size are priced per container of a size (starting at the usual one).
  const sized = item.size_quantity != null && !!item.size_unit;

  function startPricing() {
    setPricing((p) => !p);
    setPriceSize({ quantity: item!.size_quantity?.toString() ?? '', unit: item!.size_unit ?? 'ml' });
  }

  function savePrice(e: FormEvent) {
    e.preventDefault();
    const p = Number(packPrice.replace(',', '.'));
    // Sized like the item ("bottle of 500 ml"), else whatever pack size was typed.
    const q = Number(priceSize.quantity.replace(',', '.'));
    const label = sized ? (q > 0 ? `${item!.container ?? 'pack'} of ${q} ${priceSize.unit === 'piece' ? 'pieces' : priceSize.unit}` : '') : packLabel.trim();
    if (sized && !(q > 0)) return setError('Say how big the pack was, e.g. 750 ml');
    if (p > 0)
      run(() => api.setItemPrice(item!.id, p, label || '1')).then(() => {
        setPricing(false);
        setPackLabel('');
      });
  }

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="button ghost danger"
            onClick={() => {
              if (confirm(`Delete “${item.name}” and everything linked to it?`)) api.deleteCatalogItem(item.id).then(() => (onChanged(), onClose()));
            }}
          >
            <Icon name="trash" /> Delete
          </button>
          <span className="toolbar-spacer" />
          {item.in_pantry ? (
            <button type="button" className="button secondary" onClick={() => run(() => api.usedUp(item.id))}>
              Used up
            </button>
          ) : (
            <button type="button" className="button" onClick={() => run(() => api.putInPantry(item.id))}>
              <Icon name="plus" /> At home
            </button>
          )}
        </>
      }
    >
      {error && <p className="error">{error}</p>}

      <div className={`status-strip${item.in_pantry ? ' home' : ''}`}>
        {item.in_pantry ? (
          <>
            <strong>At home</strong>
            {(item.pantry_quantity !== null || item.pantry_unit) && <span> · {pantryAmount(item)}</span>}
            {item.bought_at && <span className="muted small"> · bought {item.bought_at}</span>}
            {item.pantry_source && <span className="muted small"> · {SOURCE_LABEL[item.pantry_source] ?? item.pantry_source}</span>}
            {expiry && <span className={`expiry ${expiry.level}`}>{expiry.text}</span>}
          </>
        ) : (
          <span className="muted">Not at home</span>
        )}
        {item.in_pantry && !amountEdit ? (
          <button
            type="button"
            className="text-button tiny strip-edit"
            onClick={() =>
              setAmountEdit({
                quantity: item.pantry_quantity?.toString() ?? '',
                unit: item.pantry_unit ?? item.container ?? (item.size_unit && item.size_unit !== 'piece' ? item.size_unit : ''),
              })
            }
          >
            change amount
          </button>
        ) : null}
      </div>
      {amountEdit && (
        <form className="inline-form amount-edit" onSubmit={saveAmount}>
          <input
            inputMode="decimal"
            value={amountEdit.quantity}
            onChange={(e) => setAmountEdit({ ...amountEdit, quantity: e.target.value })}
            placeholder="amount"
            aria-label="Amount at home"
            autoFocus
          />
          <select value={amountEdit.unit} onChange={(e) => setAmountEdit({ ...amountEdit, unit: e.target.value })} aria-label="Unit">
            <option value="">{amountEdit.quantity.trim() ? 'pieces' : 'no amount'}</option>
            {[...new Set([item.container, 'ml', 'l', 'g', 'kg', ...containers].filter(Boolean) as string[])].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <button type="submit" className="button small">
            Save
          </button>
          <button type="button" className="button ghost small" onClick={() => setAmountEdit(null)}>
            Cancel
          </button>
        </form>
      )}

      {item.in_pantry ? (
        <form className="inline-form use-some" onSubmit={useSome}>
          <input
            value={useAmount}
            onChange={(e) => setUseAmount(e.target.value)}
            placeholder={item.pantry_quantity !== null ? `Used some? e.g. ${usedExample(item, containers)}` : 'No amount recorded — use Used up'}
            disabled={item.pantry_quantity === null}
            aria-label="Amount used"
          />
          <button type="submit" className="button secondary small" disabled={!useAmount.trim()}>
            Take off
          </button>
        </form>
      ) : null}
      {useMsg && <p className="notice small">{useMsg}</p>}

      <div className="field-grid two">
        <label className="field">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() !== item.name && run(() => api.updateCatalogItem(item.id, { name }))} />
        </label>
        <label className="field">
          <span className="label">Aisle</span>
          <select value={item.category_id ?? ''} onChange={(e) => run(() => api.updateCatalogItem(item.id, { category_id: e.target.value || null }))}>
            <option value="">Other</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="label">Short name in recipe steps</span>
        <span className="ref-field">
          <span>{'{{'}</span>
          <input
            value={ref}
            onChange={(e) => setRef(sanitizeRef(e.target.value))}
            onBlur={saveRef}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="flour"
            aria-label="Short name in recipe steps"
          />
          <span>{'}}'}</span>
        </span>
        <span className="hint">
          A recipe's method can write <code>{`{{${ref || 'name'}}}`}</code> for the amount of this item it uses ("Sift {`{{${ref || 'name'}}}`}" →
          "Sift 1¾ cups plain flour"). Changing it updates every recipe that uses it.
        </span>
      </label>

      <section className="sheet-section">
        <h3>Comes in</h3>
        <div className="size-row">
          <select
            value={item.container ?? ''}
            onChange={(e) => saveSize({ container: e.target.value || null })}
            aria-label="Container"
          >
            <option value="">—</option>
            {containers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="muted">{item.container ? 'of usually' : 'usually holding'}</span>
          <input
            className="size-qty"
            inputMode="decimal"
            value={sizeQty}
            onChange={(e) => setSizeQty(e.target.value)}
            onBlur={saveSizeQty}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="750"
            aria-label="What one holds"
          />
          <select
            value={item.size_unit ?? ''}
            onChange={(e) => saveSize({ size_unit: e.target.value || null, ...(item.size_quantity == null && sizeQty.trim() ? { size_quantity: Number(sizeQty.replace(',', '.')) } : {}) })}
            aria-label="Size unit"
            disabled={item.size_quantity == null && !sizeQty.trim()}
          >
            <option value="">unit</option>
            {['ml', 'l', 'g', 'kg', 'piece'].map((u) => (
              <option key={u} value={u}>
                {u === 'piece' ? 'pieces' : u}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          {item.container && item.size_quantity != null
            ? `At home it can be counted in ${item.container}s; recipes take what they use off it (2 tbsp from a ${item.container} of ${formatAmount(item.size_quantity, item.size_unit === 'piece' ? null : item.size_unit ?? null)} leaves the rest), and new slips that don't say a size use this. Bought a different size? Slips that print it (500ML) use their own, and prices ask each time.`
            : 'What it comes in and what one usually holds — a bottle of 750 ml, a tin of 400 g. Recipes then take millilitres or grams off what\'s at home.'}
        </p>
      </section>

      <section className="sheet-section">
        <h3>Use by</h3>
        <div className="field-grid two">
          {item.in_pantry ? (
            <label className="field">
              <span className="label">Date on the pack</span>
              <span className="expiry-input">
                <input
                  type="date"
                  value={item.expires_at ?? ''}
                  onChange={(e) => run(() => api.setExpiry(item.id, { expires_at: e.target.value || null }))}
                />
                {item.expires_at && (
                  <button type="button" className="icon-button" onClick={() => run(() => api.setExpiry(item.id, { expires_at: null }))} aria-label="Clear date">
                    <Icon name="x" size={14} />
                  </button>
                )}
              </span>
            </label>
          ) : (
            <p className="muted small">Not at home — a date is set when it's bought.</p>
          )}
          <label className="field">
            <span className="label">Usually keeps for (days)</span>
            <input
              inputMode="numeric"
              placeholder="e.g. 90 in the freezer"
              value={keeps}
              onChange={(e) => setKeeps(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => saveKeeps(keeps)}
              onKeyDown={(e) => e.key === 'Enter' && saveKeeps(keeps)}
            />
          </label>
        </div>
        <div className="chip-row tight">
          {KEEPS_PRESETS.map(([label, days]) => (
            <button key={days} type="button" className={`chip${item.keeps_days === days ? ' active' : ''}`} onClick={() => saveKeeps(String(days))}>
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          Remembered for {item.name}: each time it's bought (from a slip or added by hand) the use-by date is filled in from this.
        </p>
      </section>

      <section className="sheet-section">
        <div className="row-between">
          <h3>Price paid</h3>
          <button type="button" className="link small" onClick={startPricing}>
            {pricing ? 'Cancel' : price ? 'Change' : 'Set price'}
          </button>
        </div>
        {price ? (
          <p className="price-line">
            <strong>{price}</strong>{' '}
            <span className="muted small">
              — {rand(item.pack_price)} for {item.pack_label} · {SOURCE_LABEL[item.price_source ?? ''] ?? item.price_source}, {item.price_at}
            </span>
          </p>
        ) : (
          !pricing && <p className="muted small">No price yet — it's filled in from BudgetPro slips, or set it here. Recipe costs use it.</p>
        )}
        {(item.paid?.filter((p) => p.store).length ?? 0) > 0 && (
          <ul className="paid-list">
            {item.paid!
              .filter((p) => p.store)
              .map((p) => (
                <li key={p.store}>
                  <strong>{p.store}</strong>
                  <span>{unitPriceLabel(p.unit_price, p.price_unit)}</span>
                  <span className="muted tiny">
                    {rand(p.pack_price)} · {p.seen_at}
                  </span>
                </li>
              ))}
          </ul>
        )}
        {pricing && (
          <form className={`price-form${sized ? ' sized' : ''}`} onSubmit={savePrice}>
            <input inputMode="decimal" placeholder="Price paid, e.g. 27" aria-label="Price paid" value={packPrice} onChange={(e) => setPackPrice(e.target.value)} autoFocus />
            {sized ? (
              <span className="size-row price-size">
                <span className="muted">for one {item.container ?? 'pack'} of</span>
                <input
                  className="size-qty"
                  inputMode="decimal"
                  value={priceSize.quantity}
                  onChange={(e) => setPriceSize({ ...priceSize, quantity: e.target.value })}
                  aria-label="Size of the pack bought"
                />
                <select value={priceSize.unit} onChange={(e) => setPriceSize({ ...priceSize, unit: e.target.value })} aria-label="Unit">
                  {['ml', 'l', 'g', 'kg', 'piece'].map((u) => (
                    <option key={u} value={u}>
                      {u === 'piece' ? 'pieces' : u}
                    </option>
                  ))}
                </select>
              </span>
            ) : (
              <input placeholder="Pack size, e.g. 18 eggs, 1.2 kg, 2 L" aria-label="Pack size" value={packLabel} onChange={(e) => setPackLabel(e.target.value)} />
            )}
            <button type="submit" className="button small">
              Save
            </button>
          </form>
        )}
      </section>

      <section className="sheet-section">
        <h3>Barcodes & other names</h3>
        {groups.length === 0 && <p className="muted small">Nothing linked yet. Scan each brand's barcode so they all count as {item.name}.</p>}
        {groups.map((g) => (
          <div key={g.kind} className="alias-group">
            <span className="muted tiny">{KIND_LABEL[g.kind]}</span>
            <div className="chip-row tight">
              {g.rows.map((a) => (
                <span key={a.value} className="chip removable" title={a.value}>
                  {g.kind === 'barcode' && <Icon name="barcode" size={13} />}
                  {a.label && a.label !== a.value ? `${a.label}` : a.value}
                  {g.kind === 'barcode' && a.label && <span className="muted tiny"> {a.value}</span>}
                  <button type="button" onClick={() => run(() => api.removeAlias(item.id, a.kind, a.value))} aria-label="Unlink">
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className="alias-add">
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              addBarcode(newBarcode);
            }}
          >
            <input inputMode="numeric" placeholder="Add barcode" value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} />
            <button type="button" className="icon-button bordered" onClick={() => setScanning(true)} aria-label="Scan barcode">
              <Icon name="barcode" />
            </button>
            <button type="submit" className="button secondary small" disabled={!newBarcode.trim()}>
              Link
            </button>
          </form>
          <form className="inline-form" onSubmit={addName}>
            <input placeholder="Add another name, e.g. Royco onion soup" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="submit" className="button secondary small" disabled={!newName.trim()}>
              Link
            </button>
          </form>
        </div>
        <button type="button" className="link small" onClick={() => setMerging(true)}>
          This is the same thing as another item…
        </button>
      </section>

      {scanning && (
        <BarcodeScanner
          onClose={() => setScanning(false)}
          onDetected={(code) => {
            setScanning(false);
            addBarcode(code);
          }}
        />
      )}
      {merging && (
        <MergePicker
          item={item}
          onClose={() => setMerging(false)}
          onMerged={() => {
            setMerging(false);
            onChanged();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

function MergePicker({ item, onClose, onMerged }: { item: ItemDetail; onClose: () => void; onMerged: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listCatalog().then(setItems).catch((e) => setError(e.message));
  }, []);
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((i) => i.id !== item.id && (!query || i.name.toLowerCase().includes(query))).slice(0, 40);
  }, [items, q, item.id]);

  async function merge(into: Item) {
    if (!confirm(`Merge “${item.name}” into “${into.name}”? Its barcodes, names and history move across and “${item.name}” becomes another name for it.`)) return;
    try {
      await api.mergeItem(item.id, into.id);
      onMerged();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Modal title={`Merge “${item.name}” into…`} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      <div className="search-input">
        <Icon name="search" />
        <input autoFocus placeholder="Find the item it really is" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="pick-list">
        {shown.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => merge(i)}>
              <span>{i.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** A sensible "used some" example: "250 ml" from a bottle of 750 ml, "1 tin" from tins, "250 g" from a kilo. */
function usedExample(item: ItemDetail, containers: string[]): string {
  const unit = item.pantry_unit;
  if (!unit) return '2';
  if (containers.includes(unit)) {
    const u = item.size_unit;
    if (u && u !== 'piece') return `${u === 'kg' || u === 'g' ? 100 : 30} ${u === 'kg' ? 'g' : u === 'l' ? 'ml' : u}`;
    return `1 ${unit}`;
  }
  return `250 ${unit === 'kg' ? 'g' : unit === 'l' ? 'ml' : unit}`;
}
