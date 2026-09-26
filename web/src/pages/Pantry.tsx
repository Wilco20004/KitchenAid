import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { BarcodeResult, BudgetProStatus, Category, Item } from '../types';
import { daysUntil, expiryLabel, formatAmount, unitPriceLabel } from '../utils/format';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import ItemSheet from '../components/ItemSheet';
import BarcodeScanner from '../components/BarcodeScanner';

export default function Pantry() {
  const [view, setView] = useState<'home' | 'all'>('home');
  const [items, setItems] = useState<Item[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<BarcodeResult | null>(null);
  const [bp, setBp] = useState<BudgetProStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .listCatalog({ pantry: view === 'home' })
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [view]);

  useEffect(reload, [reload]);
  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => setCategories([]));
    api.budgetProStatus().then(setBp).catch(() => setBp(null));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.addPantryText(text);
      setText('');
      reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function usedUp(i: Item) {
    await api.usedUp(i.id);
    reload();
  }

  async function lookup(code: string) {
    setScanning(false);
    setError(null);
    try {
      const r = await api.lookupBarcode(code);
      if (r.item) setOpenId(r.item.id);
      else setScanResult(r);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const r = await api.syncBudgetPro();
      setMessage(
        r.receipts
          ? `${r.receipts} new slip${r.receipts === 1 ? '' : 's'}: ${r.items} item${r.items === 1 ? '' : 's'} added${r.ticked ? `, ${r.ticked} ticked off the shopping list` : ''}.`
          : 'No new grocery slips.'
      );
      setBp(await api.budgetProStatus());
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !query || i.name.toLowerCase().includes(query));
  }, [items, q]);

  // At home and expired or going off within a week: first, soonest on top.
  const useSoon = useMemo(
    () =>
      view === 'home'
        ? shown.filter((i) => i.expires_at && daysUntil(i.expires_at) <= 7).sort((a, b) => a.expires_at!.localeCompare(b.expires_at!))
        : [],
    [shown, view]
  );

  // The rest grouped by aisle, in shop order, like the shopping list.
  const groups = useMemo(() => {
    const order = new Map(categories.map((c, i) => [c.id, i]));
    const map = new Map<string, { name: string; pos: number; items: Item[] }>();
    for (const i of shown) {
      if (useSoon.includes(i)) continue;
      const key = i.category_id && order.has(i.category_id) ? i.category_id : '';
      const g = map.get(key) ?? { name: key ? categories.find((c) => c.id === key)!.name : 'Other', pos: key ? order.get(key)! : 999, items: [] };
      g.items.push(i);
      map.set(key, g);
    }
    const sorted = [...map.values()].sort((a, b) => a.pos - b.pos);
    return useSoon.length ? [{ name: 'Use soon', pos: -1, items: useSoon, soon: true }, ...sorted] : sorted;
  }, [shown, categories, useSoon]);

  return (
    <div className="pantry">
      <div className="page-head">
        <h1>Pantry</h1>
        <div className="page-actions">
          <button type="button" className="button" onClick={() => setScanning(true)}>
            <Icon name="barcode" /> Scan
          </button>
        </div>
      </div>

      <div className="segmented">
        <button type="button" className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>
          At home
        </button>
        <button type="button" className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
          All items
        </button>
      </div>

      {bp?.configured && (
        <div className="bp-strip small">
          <span>
            <Icon name="refresh" size={14} /> BudgetPro slips{' '}
            <span className="muted">
              {bp.lastSync ? `· checked ${new Date(bp.lastSync).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : '· not synced yet'}
            </span>
          </span>
          <button type="button" className="link small" onClick={sync} disabled={syncing}>
            {syncing ? 'Checking…' : 'Check now'}
          </button>
        </div>
      )}
      {bp?.lastError && <p className="error small">BudgetPro: {bp.lastError}</p>}
      {message && <p className="notice small">{message}</p>}
      {error && <p className="error">{error}</p>}

      {view === 'home' && (
        <form className="inline-form" onSubmit={add}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something you have — e.g. 2 kg rice" />
          <button type="submit" className="button secondary">
            Add
          </button>
        </form>
      )}
      <div className="search-input">
        <Icon name="search" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={view === 'home' ? 'Search the pantry' : 'Search all items'} />
      </div>

      {items === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="empty">
          <div className="empty-emoji">🥫</div>
          <h2>{view === 'home' ? 'Nothing in the pantry yet' : 'No items'}</h2>
          <p className="muted">
            {view === 'home'
              ? 'Things arrive here when you tick them off the shopping list and clear it, from BudgetPro slips, or when you add them above.'
              : 'Items are created as you add things to lists, the pantry, or scan barcodes.'}
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.name} className={`aisle${'soon' in g ? ' use-soon' : ''}`}>
            <h2>
              {g.name} <span className="count">{g.items.length}</span>
            </h2>
            <ul className="shop-list">
              {g.items.map((i) => {
                const expiry = i.in_pantry && i.expires_at ? expiryLabel(i.expires_at) : null;
                return (
                <li key={i.id}>
                  <button type="button" className="shop-item" onClick={() => setOpenId(i.id)}>
                    <span className={`dot${i.in_pantry ? ' on' : ''}`} aria-hidden="true" />
                    <span className="shop-item-text">
                      <span>
                        <span className="shop-name">{i.name}</span>
                        {(i.pantry_quantity !== null || i.pantry_unit) && i.in_pantry ? (
                          <span className="shop-amount">{formatAmount(i.pantry_quantity, i.pantry_unit)}</span>
                        ) : null}
                      </span>
                      <span className="muted tiny">
                        {expiry && <span className={`expiry ${expiry.level}`}>{expiry.text}</span>}
                        {[
                          unitPriceLabel(i.unit_price, i.price_unit),
                          i.in_pantry && i.bought_at ? `bought ${i.bought_at}` : null,
                          i.barcode_count ? `${i.barcode_count} barcode${i.barcode_count === 1 ? '' : 's'}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                  {view === 'home' && (
                    <button type="button" className="button ghost small" onClick={() => usedUp(i)} title="Used it up">
                      Used up
                    </button>
                  )}
                </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {scanning && <BarcodeScanner onClose={() => setScanning(false)} onDetected={lookup} />}
      {scanResult && (
        <NewBarcode
          result={scanResult}
          onClose={() => setScanResult(null)}
          onLinked={(id) => {
            setScanResult(null);
            setOpenId(id);
            reload();
          }}
        />
      )}
      {openId && <ItemSheet itemId={openId} categories={categories} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

/** A barcode nothing is linked to yet: link it to an existing item, or start a new one. */
function NewBarcode({ result, onClose, onLinked }: { result: BarcodeResult; onClose: () => void; onLinked: (itemId: string) => void }) {
  const suggestedName = result.lookup?.name ?? '';
  const productLabel = [result.lookup?.brand, result.lookup?.name, result.lookup?.quantity].filter(Boolean).join(' ') || null;
  const [name, setName] = useState(suggestedName);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCatalog().then(setItems).catch(() => setItems([]));
  }, []);

  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? items.filter((i) => i.name.toLowerCase().includes(query)).slice(0, 8) : [];
  }, [items, q]);

  async function link(itemId: string) {
    try {
      await api.addAlias(itemId, 'barcode', result.code, productLabel);
      await api.putInPantry(itemId);
      onLinked(itemId);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const item = await api.createCatalogItem({ name: name.trim(), barcode: result.code, barcode_label: productLabel });
      await api.putInPantry(item.id);
      onLinked(item.id);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Modal title="New barcode" onClose={onClose}>
      <div className="scan-found">
        {result.lookup?.image && <img src={result.lookup.image} alt="" referrerPolicy="no-referrer" />}
        <div>
          <strong>{productLabel ?? 'Unknown product'}</strong>
          <div className="muted tiny">
            <Icon name="barcode" size={12} /> {result.code}
          </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {(result.suggestions?.length ?? 0) > 0 && (
        <>
          <h3>Is it one of these?</h3>
          <div className="chip-row">
            {result.suggestions!.map((s) => (
              <button key={s.id} type="button" className="chip" onClick={() => link(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        </>
      )}

      <h3>Link to an item you have</h3>
      <div className="search-input">
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. brown onion soup" />
      </div>
      {matches.length > 0 && (
        <ul className="pick-list">
          {matches.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => link(i.id)}>
                <span>{i.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>…or make it a new item</h3>
      <form className="inline-form" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it by what it is, e.g. Brown onion soup" />
        <button type="submit" className="button" disabled={!name.trim()}>
          Create
        </button>
      </form>
      <p className="hint">Name items by what they are, not the brand, so other brands' barcodes can join them later.</p>
    </Modal>
  );
}
