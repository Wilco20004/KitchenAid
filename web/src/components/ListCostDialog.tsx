import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ItemMatch, ShoppingItem } from '../types';
import { formatAmount, rand } from '../utils/format';
import Modal from './Modal';

/**
 * "What will this list cost at each shop?" Items are priced one at a time
 * so there's visible progress — the first check of the day asks each store
 * about each item (a couple of seconds each); after that it's cached.
 */
export default function ListCostDialog({ items, onClose }: { items: ShoppingItem[]; onClose: () => void }) {
  const [matches, setMatches] = useState<(ItemMatch | { error: string; name: string })[]>([]);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    (async () => {
      for (const i of items) {
        if (cancelled.current) return;
        try {
          const m = await api.matchItem({ name: i.name, quantity: i.quantity, unit: i.unit });
          setMatches((ms) => [...ms, m]);
        } catch (e: any) {
          setMatches((ms) => [...ms, { error: e.message, name: i.name }]);
        }
      }
      setDone(true);
    })();
    return () => {
      cancelled.current = true;
    };
  }, [items]);

  const priced = matches.filter((m): m is ItemMatch => 'stores' in m);
  const storeIds = priced[0]?.stores.map((s) => ({ id: s.store, name: s.storeName })) ?? [];
  const totals = storeIds
    .map((s) => {
      let total = 0;
      let found = 0;
      for (const m of priced) {
        const best = m.stores.find((x) => x.store === s.id)?.best;
        if (best) {
          total += best.cost;
          found++;
        }
      }
      return { ...s, total, found };
    })
    .sort((a, b) => b.found - a.found || a.total - b.total);
  let mix = 0;
  let mixFound = 0;
  for (const m of priced) {
    const costs = m.stores.map((s) => s.best?.cost).filter((c): c is number => c !== undefined);
    if (costs.length) {
      mix += Math.min(...costs);
      mixFound++;
    }
  }

  return (
    <Modal title="What will this cost?" onClose={onClose} wide>
      {!done && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${(matches.length / Math.max(1, items.length)) * 100}%` }} />
          <span className="muted small">
            Checking {Math.min(matches.length + 1, items.length)} of {items.length}… the first check each day takes a few seconds per item.
          </span>
        </div>
      )}

      {priced.length > 0 && (
        <div className="best-grid">
          {totals.map((t, idx) => (
            <div key={t.id} className={`best${idx === 0 && t.found === priced.length ? ' winner' : ''}`}>
              <span className="muted tiny">{t.name}</span>
              <span className="best-price">{rand(t.total)}</span>
              <span className="muted tiny">
                {t.found} of {priced.length} items found
              </span>
            </div>
          ))}
          <div className="best mix">
            <span className="muted tiny">Cheapest mix of shops</span>
            <span className="best-price">{rand(mix)}</span>
            <span className="muted tiny">{mixFound} items</span>
          </div>
        </div>
      )}
      <p className="muted tiny">
        Estimates: each item is matched to the product that covers the amount you need most cheaply. Store search is fuzzy — tap an item
        to check what was picked.
      </p>

      <ul className="cost-list">
        {matches.map((m, idx) => {
          const need = items[idx];
          if (!('stores' in m)) {
            return (
              <li key={idx}>
                <span>{m.name}</span>
                <span className="error small">{m.error}</span>
              </li>
            );
          }
          const cheapest = Math.min(...m.stores.map((s) => s.best?.cost ?? Infinity));
          return (
            <li key={idx} className={open === idx ? 'open' : ''}>
              <button type="button" className="cost-row" onClick={() => setOpen(open === idx ? null : idx)}>
                <span className="cost-name">
                  {m.name}
                  {need && (need.quantity !== null || need.unit) && <span className="muted tiny"> {formatAmount(need.quantity, need.unit)}</span>}
                </span>
                {m.stores.map((s) => (
                  <span key={s.store} className={`cost-cell${s.best && s.best.cost === cheapest ? ' low' : ''}`} title={s.storeName}>
                    {s.best ? rand(s.best.cost) : '—'}
                  </span>
                ))}
              </button>
              {open === idx && (
                <div className="cost-detail">
                  {m.stores.map((s) => (
                    <div key={s.store} className="small">
                      <strong>{s.storeName}:</strong>{' '}
                      {s.best ? (
                        <>
                          {s.best.packs > 1 ? `${s.best.packs} × ` : ''}
                          {s.best.product.url ? (
                            <a href={s.best.product.url} target="_blank" rel="noreferrer">
                              {s.best.product.name}
                            </a>
                          ) : (
                            s.best.product.name
                          )}{' '}
                          <span className="muted">({rand(s.best.product.price)})</span>
                        </>
                      ) : (
                        <span className="muted">{s.error ?? 'nothing matching found'}</span>
                      )}
                    </div>
                  ))}
                  <Link to={`/prices?q=${encodeURIComponent(m.term)}`} className="link small">
                    Compare “{m.term}” in detail →
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {storeIds.length > 0 && (
        <div className="cost-legend muted tiny">
          Columns: {storeIds.map((s) => s.name).join(' · ')}
        </div>
      )}
    </Modal>
  );
}
