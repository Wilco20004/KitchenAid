import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Category, ShoppingItem, ShoppingList as List } from '../types';
import { formatAmount } from '../utils/format';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import ListCostDialog from '../components/ListCostDialog';
import { Link } from 'react-router-dom';

const LIST_KEY = 'kitchenaid.shoppingList';
const POLL_MS = 8000;

// Browser storage only remembers which list tab you had open; it can be
// missing (private windows, blocked storage), so every access is guarded.
function rememberedList(): string | null {
  try {
    return localStorage.getItem(LIST_KEY);
  } catch {
    return null;
  }
}
function rememberList(id: string) {
  try {
    localStorage.setItem(LIST_KEY, id);
  } catch {
    /* not important */
  }
}

export default function ShoppingList() {
  const [lists, setLists] = useState<List[]>([]);
  const [listId, setListId] = useState<string | null>(null);
  const [items, setItems] = useState<ShoppingItem[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<{ name: string }[]>([]);
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [costing, setCosting] = useState<ShoppingItem[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => setCategories([]));
    api
      .listShoppingLists()
      .then((ls) => {
        setLists(ls);
        const saved = rememberedList();
        setListId(ls.find((l) => l.id === saved)?.id ?? ls[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  const reload = useCallback(() => {
    if (!listId) return;
    api
      .listItems(listId)
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [listId]);

  // Someone else in the house may be adding to the same list: refresh while
  // the page is visible, and straight away when you come back to it.
  useEffect(() => {
    reload();
    const timer = setInterval(() => document.visibilityState === 'visible' && reload(), POLL_MS);
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return setSuggestions([]);
    const t = setTimeout(() => {
      api
        .suggest(q.replace(/^[\d.,/\s]+(kg|g|ml|l|x)?\s*/i, ''))
        .then((s) => setSuggestions(s.filter((x) => x.name.toLowerCase() !== q.toLowerCase()).slice(0, 6)))
        .catch(() => setSuggestions([]));
    }, 150);
    return () => clearTimeout(t);
  }, [text]);

  async function add(e?: FormEvent, value = text) {
    e?.preventDefault();
    if (!listId || !value.trim()) return;
    setText('');
    setSuggestions([]);
    try {
      await api.addItemText(listId, value);
      reload();
    } catch (err: any) {
      setError(err.message);
    }
    inputRef.current?.focus();
  }

  async function toggle(item: ShoppingItem) {
    setItems((is) => is?.map((i) => (i.id === item.id ? { ...i, checked: !i.checked, checked_at: new Date().toISOString() } : i)) ?? null);
    try {
      await api.updateItem(item.id, { checked: !item.checked });
    } catch (err: any) {
      setError(err.message);
      reload();
    }
  }

  // Ticked means bought, so clearing moves them into the pantry.
  async function clearDone() {
    if (!listId) return;
    const r = await api.clearChecked(listId);
    setNotice(`${r.toPantry} item${r.toPantry === 1 ? '' : 's'} moved to the pantry.`);
    reload();
  }

  function switchList(id: string) {
    setListId(id);
    setItems(null);
    rememberList(id);
  }

  const open = (items ?? []).filter((i) => !i.checked);
  const done = (items ?? []).filter((i) => i.checked);
  const groups = [...categories, { id: '', name: 'Other', position: 999 }]
    .map((c) => ({ category: c, items: open.filter((i) => (i.category_id ?? '') === c.id) }))
    .filter((g) => g.items.length);
  // Items in an aisle that was since deleted fall into the catch-all group.
  const known = new Set(categories.map((c) => c.id));
  const orphans = open.filter((i) => i.category_id && !known.has(i.category_id));
  if (orphans.length) {
    const other = groups.find((g) => g.category.id === '');
    if (other) other.items.push(...orphans);
    else groups.push({ category: { id: '', name: 'Other', position: 999 }, items: orphans });
  }

  return (
    <div className="shopping">
      <div className="page-head">
        <h1>Shopping</h1>
        <div className="page-actions">
          {open.length > 0 && (
            <button type="button" className="button secondary small" onClick={() => setCosting(open)}>
              <Icon name="tag" size={16} /> What will it cost?
            </button>
          )}
          {done.length > 0 && (
            <button type="button" className="button ghost small" onClick={clearDone} title="Ticked items go to the pantry">
              Clear {done.length} ticked
            </button>
          )}
        </div>
      </div>

      {lists.length > 1 && (
        <div className="chip-row scroll">
          {lists.map((l) => (
            <button key={l.id} type="button" className={`chip${l.id === listId ? ' active' : ''}`} onClick={() => switchList(l.id)}>
              {l.name}
            </button>
          ))}
        </div>
      )}

      <form className="add-bar" onSubmit={add}>
        <div className="search-input big">
          <Icon name="plus" />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add an item — e.g. 2 kg potatoes"
            aria-label="Add an item"
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => {
                    const qty = text.match(/^([\d.,/\s]+(?:kg|g|ml|l)?\s+)/i)?.[1] ?? '';
                    add(undefined, `${qty}${s.name}`);
                  }}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="notice small" onClick={() => setNotice(null)}>
          {notice}
        </p>
      )}

      {items === null ? (
        <p className="muted">Loading…</p>
      ) : open.length === 0 && done.length === 0 ? (
        <div className="empty">
          <div className="empty-emoji">🛒</div>
          <h2>Nothing on the list</h2>
          <p className="muted">Type above, or send a recipe's ingredients here from the recipe or the meal plan.</p>
        </div>
      ) : (
        <>
          {open.length === 0 && <p className="all-done">All done 🎉</p>}
          {groups.map((g) => (
            <section key={g.category.id || 'other'} className="aisle">
              <h2>
                {g.category.name} <span className="count">{g.items.length}</span>
              </h2>
              <ul className="shop-list">
                {g.items.map((i) => (
                  <ItemRow key={i.id} item={i} onToggle={toggle} onEdit={setEditing} />
                ))}
              </ul>
            </section>
          ))}

          {done.length > 0 && (
            <section className="aisle done-section">
              <button type="button" className="done-toggle" onClick={() => setShowDone((s) => !s)}>
                <Icon name={showDone ? 'down' : 'right'} size={16} /> In the trolley <span className="count">{done.length}</span>
              </button>
              {showDone && (
                <ul className="shop-list">
                  {done.map((i) => (
                    <ItemRow key={i.id} item={i} onToggle={toggle} onEdit={setEditing} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {costing && <ListCostDialog items={costing} onClose={() => setCosting(null)} />}
      {editing && (
        <ItemDialog
          item={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function ItemRow({ item, onToggle, onEdit }: { item: ShoppingItem; onToggle: (i: ShoppingItem) => void; onEdit: (i: ShoppingItem) => void }) {
  const amount = formatAmount(item.quantity, item.unit);
  return (
    <li className={item.checked ? 'checked' : ''}>
      <button type="button" className="shop-item" onClick={() => onToggle(item)} aria-pressed={item.checked}>
        <span className="tick" aria-hidden="true">
          {item.checked && <Icon name="check" size={14} />}
        </span>
        <span className="shop-item-text">
          <span>
            <span className="shop-name">{item.name}</span>
            {amount && <span className="shop-amount">{amount}</span>}
          </span>
          {(item.note || item.sources) && <span className="muted tiny">{[item.note, item.sources].filter(Boolean).join(' · ')}</span>}
        </span>
      </button>
      <button type="button" className="icon-button" onClick={() => onEdit(item)} aria-label={`Edit ${item.name}`}>
        <Icon name="more" />
      </button>
    </li>
  );
}

function ItemDialog({
  item,
  categories,
  onClose,
  onChanged,
}: {
  item: ShoppingItem;
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity?.toString() ?? '');
  const [unit, setUnit] = useState(item.unit ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [categoryId, setCategoryId] = useState(item.category_id ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    try {
      await api.updateItem(item.id, {
        name,
        quantity: quantity.trim() === '' ? null : Number(quantity.replace(',', '.')),
        unit,
        note,
        category_id: categoryId || null,
      });
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function remove() {
    await api.deleteItem(item.id);
    onChanged();
  }

  return (
    <Modal
      title="Edit item"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button ghost danger" onClick={remove}>
            <Icon name="trash" /> Delete
          </button>
          <span className="toolbar-spacer" />
          <button type="button" className="button" onClick={() => save()}>
            Save
          </button>
        </>
      }
    >
      <form onSubmit={save}>
        {error && <p className="error">{error}</p>}
        <label className="field">
          <span className="label">Item</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field-grid two">
          <label className="field">
            <span className="label">Amount</span>
            <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Unit</span>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="g, kg, ml, pack…" />
          </label>
        </div>
        <label className="field">
          <span className="label">Aisle</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Other</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="hint">Remembered next time you add {name || 'this'}.</span>
          <Link to={`/prices?q=${encodeURIComponent(name)}`} className="link small">
            Compare prices for {name || 'this'} →
          </Link>
        </label>
        <label className="field">
          <span className="label">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="brand, size…" />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
