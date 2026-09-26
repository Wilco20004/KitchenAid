import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Category, Item, ItemAlias, ItemDetail } from '../types';
import { formatAmount, rand, unitPriceLabel } from '../utils/format';
import Modal from './Modal';
import Icon from './Icon';
import BarcodeScanner from './BarcodeScanner';

const KIND_LABEL: Record<ItemAlias['kind'], string> = {
  barcode: 'Barcode',
  name: 'Also called',
  slip: 'On slips as',
  store: 'Shop product',
};

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
  const [pricing, setPricing] = useState(false);
  const [packPrice, setPackPrice] = useState('');
  const [packLabel, setPackLabel] = useState('');
  const [newName, setNewName] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    api
      .getCatalogItem(itemId)
      .then((i) => {
        setItem(i);
        setName(i.name);
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

  function savePrice(e: FormEvent) {
    e.preventDefault();
    const p = Number(packPrice.replace(',', '.'));
    if (p > 0) run(() => api.setItemPrice(item!.id, p, packLabel || '1')).then(() => setPricing(false));
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
            {(item.pantry_quantity !== null || item.pantry_unit) && <span> · {formatAmount(item.pantry_quantity, item.pantry_unit)}</span>}
            {item.bought_at && <span className="muted small"> · bought {item.bought_at}</span>}
            {item.pantry_source && <span className="muted small"> · {SOURCE_LABEL[item.pantry_source] ?? item.pantry_source}</span>}
          </>
        ) : (
          <span className="muted">Not at home</span>
        )}
      </div>

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

      <section className="sheet-section">
        <div className="row-between">
          <h3>Price paid</h3>
          <button type="button" className="link small" onClick={() => setPricing((p) => !p)}>
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
        {pricing && (
          <form className="price-form" onSubmit={savePrice}>
            <input inputMode="decimal" placeholder="Pack price, e.g. 72" value={packPrice} onChange={(e) => setPackPrice(e.target.value)} autoFocus />
            <input placeholder="Pack size, e.g. 18 eggs, 1.2 kg, 2 L" value={packLabel} onChange={(e) => setPackLabel(e.target.value)} />
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
