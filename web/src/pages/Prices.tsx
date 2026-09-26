import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ago, applyFilters, basisUnit, basisValue, money, sortByBasis, suspectIds } from '../utils/compare';
import { Basis, Product, RecentTerm, SearchResponse, StoreStatus, WatchItem } from '../types';
import Icon from '../components/Icon';

// Grocery price comparison (formerly the PriceScout add-on): each store is
// asked about a search once a day, then filtering and sorting are local.

const BASES: { id: Basis; label: string }[] = [
  { id: 'measure', label: 'Per kg / L' },
  { id: 'item', label: 'Per item' },
  { id: 'pack', label: 'Pack price' },
];

export default function Prices() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'watch' ? 'watch' : 'search';
  return (
    <div className="prices">
      <div className="page-head">
        <h1>Prices</h1>
      </div>
      <div className="segmented">
        <button type="button" className={tab === 'search' ? 'active' : ''} onClick={() => setParams({})}>
          Compare
        </button>
        <button type="button" className={tab === 'watch' ? 'active' : ''} onClick={() => setParams({ tab: 'watch' })}>
          Watchlist
        </button>
      </div>
      {tab === 'search' ? <Search /> : <Watchlist />}
    </div>
  );
}

function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentTerm[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [basis, setBasis] = useState<Basis>((params.get('basis') as Basis) || 'measure');
  const [includeWords, setIncludeWords] = useState(params.get('inc') ?? '');
  const [excludeWords, setExcludeWords] = useState(params.get('exc') ?? '');
  const [hiddenStores, setHiddenStores] = useState<Set<string>>(new Set());
  const [inStockOnly, setInStockOnly] = useState(false);

  const run = async (term: string, force = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.searchPrices(term, force));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setInput(q);
    if (q) run(q);
    else setData(null);
    api.recentPriceSearches().then(setRecent).catch(() => {});
  }, [q]);

  // Links from the watchlist carry that watch's filters.
  useEffect(() => {
    const b = params.get('basis') as Basis | null;
    if (b && BASES.some((x) => x.id === b)) setBasis(b);
    setIncludeWords(params.get('inc') ?? '');
    setExcludeWords(params.get('exc') ?? '');
  }, [params]);

  useEffect(() => {
    api.priceWatchlist().then(setWatchlist).catch(() => {});
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = input.trim();
    if (term.length < 2) return;
    setParams({ q: term });
  };

  const visibleStores = useMemo(
    () => new Set((data?.stores ?? []).map((s) => s.store).filter((s) => !hiddenStores.has(s))),
    [data, hiddenStores]
  );
  const filtered = useMemo(
    () => (data ? sortByBasis(applyFilters(data.products, { includeWords, excludeWords, stores: visibleStores, inStockOnly }), basis) : []),
    [data, includeWords, excludeWords, visibleStores, inStockOnly, basis]
  );
  const suspects = useMemo(() => suspectIds(filtered, basis), [filtered, basis]);
  const ranked = filtered.filter((p) => basisValue(p, basis) != null && !suspects.has(p.id));
  const listed = [...filtered.filter((p) => !suspects.has(p.id)), ...filtered.filter((p) => suspects.has(p.id))];

  const updateProduct = (p: Product) => setData((d) => (d ? { ...d, products: d.products.map((x) => (x.id === p.id ? p : x)) } : d));

  const watched = data ? watchlist.find((w) => w.termKey === data.termKey) : undefined;
  const toggleWatch = async () => {
    if (!data) return;
    if (watched) await api.unwatchPrice(data.termKey);
    else await api.watchPrice({ term: data.term, includeWords, excludeWords, basis });
    setWatchlist(await api.priceWatchlist());
  };
  const watchedFiltersChanged =
    watched && (watched.includeWords !== includeWords || watched.excludeWords !== excludeWords || watched.basis !== basis);

  return (
    <>
      <form className="add-bar static" onSubmit={submit}>
        <div className="search-input big">
          <Icon name="search" />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="toilet paper, chopped tomatoes, eggs…" aria-label="Search products" />
          <button type="submit" className="button small" disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {!q && (
        <div className="panel">
          <p className="muted small" style={{ marginTop: 0 }}>
            Compares Pick n Pay, Makro and Woolworths per kg, litre or item. Each store is asked about a search once a day, so
            filtering, sorting and coming back later cost them nothing. Star a search to have it refreshed daily.
          </p>
          {recent.length > 0 && (
            <>
              <h3>Recent searches</h3>
              <div className="chip-row">
                {recent.map((r) => (
                  <Link key={r.termKey} className="chip" to={`/prices?q=${encodeURIComponent(r.term)}`}>
                    {r.term}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <div className="store-row">
            {data.stores.map((s) => (
              <label key={s.store} className={`store-pill${s.error || s.pausedUntil ? ' bad' : ''}${hiddenStores.has(s.store) ? ' off' : ''}`}>
                <input
                  type="checkbox"
                  checked={!hiddenStores.has(s.store)}
                  onChange={() =>
                    setHiddenStores((h) => {
                      const next = new Set(h);
                      if (next.has(s.store)) next.delete(s.store);
                      else next.add(s.store);
                      return next;
                    })
                  }
                />
                <span>
                  <strong>{s.name}</strong>
                  <span className="muted tiny">{storeNote(s)}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="toolbar compact">
            <div className="segmented" role="group" aria-label="Compare by">
              {BASES.map((b) => (
                <button key={b.id} type="button" className={basis === b.id ? 'active' : ''} onClick={() => setBasis(b.id)}>
                  {b.label}
                </button>
              ))}
            </div>
            <span className="toolbar-spacer" />
            <button type="button" className={`button small ${watched ? '' : 'secondary'}`} onClick={toggleWatch}>
              {watched ? '★ Watching' : '☆ Watch daily'}
            </button>
            {watchedFiltersChanged && (
              <button
                type="button"
                className="button secondary small"
                onClick={async () => {
                  await api.watchPrice({ term: data.term, includeWords, excludeWords, basis });
                  setWatchlist(await api.priceWatchlist());
                }}
              >
                Save filters
              </button>
            )}
            <button type="button" className="icon-button bordered" onClick={() => run(data.term, true)} disabled={loading} title="Ask the stores again (ignore the 24 h cache)">
              <Icon name="refresh" />
            </button>
          </div>
          <div className="filter-row">
            <input value={includeWords} onChange={(e) => setIncludeWords(e.target.value)} placeholder="must include… (e.g. chopped)" />
            <input value={excludeWords} onChange={(e) => setExcludeWords(e.target.value)} placeholder="exclude… (e.g. paste sauce)" />
            <label className="check nowrap">
              <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> In stock
            </label>
          </div>

          <BestPerStore products={ranked} basis={basis} stores={data.stores.filter((s) => visibleStores.has(s.store))} />

          <p className="muted small">
            {filtered.length} of {data.products.length} products
            {basis === 'measure' && ' · no readable size sinks to the bottom — tap the size to set it'}
          </p>
          <div className="results">
            {listed.map((p, i) => (
              <ResultRow key={p.id} p={p} basis={basis} best={i === 0 && basisValue(p, basis) != null && !suspects.has(p.id)} suspect={suspects.has(p.id)} onUpdated={updateProduct} />
            ))}
            {!loading && filtered.length === 0 && <p className="muted">Nothing matches — loosen the filters.</p>}
          </div>
        </>
      )}
    </>
  );
}

function storeNote(s: StoreStatus): string {
  const age = s.fetchedAt ? `cached ${ago(s.fetchedAt)}` : 'no results yet';
  if (s.pausedUntil) {
    const until = new Date(s.pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${s.count} · paused until ${until} (store refused)`;
  }
  if (s.error) return `${s.count} · failed: ${s.error}`;
  return `${s.count} · ${s.refreshed ? 'just now' : age}`;
}

function BestPerStore({ products, basis, stores }: { products: Product[]; basis: Basis; stores: { store: string; name: string }[] }) {
  // Sorted already, so the first per store is its cheapest — within the
  // leading unit only, so a litre never "beats" a kilogram.
  const lead = products[0];
  if (!lead) return null;
  const sameUnit = products.filter((p) => basis !== 'measure' || p.measureLabel === lead.measureLabel);
  const cheapest = stores
    .map((s) => ({ s, p: sameUnit.find((p) => p.store === s.store) }))
    .filter((x): x is { s: { store: string; name: string }; p: Product } => !!x.p);
  return (
    <div className="best-grid">
      {cheapest.map(({ s, p }) => (
        <div key={s.store} className={`best${p.id === lead.id ? ' winner' : ''}`}>
          <span className="muted tiny">{p.id === lead.id ? 'Cheapest overall' : `Cheapest at ${s.name}`}</span>
          <span className="best-price">
            {money(basisValue(p, basis))} <span className="muted small">{basisUnit(p, basis)}</span>
          </span>
          <span className="small">{s.name}</span>
          <span className="muted tiny clamp">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

function ResultRow({ p, basis, best, suspect, onUpdated }: { p: Product; basis: Basis; best: boolean; suspect: boolean; onUpdated: (p: Product) => void }) {
  const [editing, setEditing] = useState(false);
  const [size, setSize] = useState(p.sizeOverride ?? '');
  const value = basisValue(p, basis);

  const saveSize = async (e: FormEvent) => {
    e.preventDefault();
    onUpdated(await api.setProductSize(p.id, size.trim() || null));
    setEditing(false);
  };

  return (
    <div className={`result${best ? ' best-row' : ''}${p.inStock === false ? ' oos' : ''}`}>
      {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="noimg" />}
      <div className="result-main">
        {p.url ? (
          <a href={p.url} target="_blank" rel="noreferrer" className="result-title">
            {p.name}
          </a>
        ) : (
          <span className="result-title">{p.name}</span>
        )}
        <div className="muted tiny result-meta">
          <span className={`store-tag s-${p.store}`}>{p.storeName}</span>
          {editing ? (
            <form className="size-edit" onSubmit={saveSize}>
              <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 9 rolls, 1.2 kg" autoFocus />
              <button type="submit" className="button small">
                Save
              </button>
              <button type="button" className="button ghost small" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="link tiny" onClick={() => setEditing(true)} title="Set the pack size by hand">
              {p.sizeOverride ? `size: ${p.sizeOverride} (yours)` : p.sizeText || 'set size'}
            </button>
          )}
          {p.inStock === false && <span className="pill tiny">out of stock</span>}
          {suspect && <span className="pill tiny warn">check size</span>}
        </div>
        {p.promo && <div className="promo tiny">{p.promo}</div>}
      </div>
      <div className="result-price">
        <strong>{value == null ? <span className="muted">no size</span> : money(value)}</strong>
        <span className="muted tiny">{value != null && basisUnit(p, basis)}</span>
        {basis !== 'pack' && <span className="muted tiny">{money(p.price)} pack</span>}
        {p.wasPrice && <span className="muted tiny strike">{money(p.wasPrice)}</span>}
      </div>
    </div>
  );
}

function Watchlist() {
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [results, setResults] = useState<Record<string, SearchResponse | string>>({});

  useEffect(() => {
    (async () => {
      const list = await api.priceWatchlist();
      setItems(list);
      // One at a time: almost always from the cache, and when not, there's no
      // need to fire every store request at once.
      for (const w of list) {
        try {
          const r = await api.searchPrices(w.term);
          setResults((prev) => ({ ...prev, [w.termKey]: r }));
        } catch (e: any) {
          setResults((prev) => ({ ...prev, [w.termKey]: e.message }));
        }
      }
    })();
  }, []);

  if (!items) return <p className="muted">Loading…</p>;
  if (items.length === 0)
    return (
      <div className="empty">
        <div className="empty-emoji">⭐</div>
        <h2>Nothing watched yet</h2>
        <p className="muted">Search for something, narrow it with the filters, then press ☆ Watch daily. Watched searches refresh every day on their own.</p>
      </div>
    );

  return (
    <div className="watch-grid">
      {items.map((w) => {
        const result = results[w.termKey];
        const link = `/prices?${new URLSearchParams({ q: w.term, inc: w.includeWords, exc: w.excludeWords, basis: w.basis })}`;
        let body: JSX.Element;
        if (result === undefined) body = <p className="muted small">Checking…</p>;
        else if (typeof result === 'string') body = <p className="error small">{result}</p>;
        else {
          const stores = new Set(result.stores.map((s) => s.store));
          const sorted = sortByBasis(applyFilters(result.products, { includeWords: w.includeWords, excludeWords: w.excludeWords, stores, inStockOnly: false }), w.basis);
          const suspects = suspectIds(sorted, w.basis);
          const ranked = sorted.filter((p) => basisValue(p, w.basis) != null && !suspects.has(p.id));
          const lead = ranked[0];
          const perStore = result.stores
            .map((s) => ({ s, p: ranked.find((p) => p.store === s.store && (w.basis !== 'measure' || p.measureLabel === lead?.measureLabel)) }))
            .sort((a, b) => (a.p ? basisValue(a.p, w.basis)! : Infinity) - (b.p ? basisValue(b.p, w.basis)! : Infinity));
          const oldest = result.stores.map((s) => s.fetchedAt).filter(Boolean).sort()[0] ?? null;
          body = (
            <>
              <table className="mini">
                <tbody>
                  {perStore.map(({ s, p }) => (
                    <tr key={s.store} className={p && p.id === lead?.id ? 'winner' : ''}>
                      <td>{s.name}</td>
                      <td className="num">{p ? money(basisValue(p, w.basis)) : '—'}</td>
                      <td className="muted tiny">{p ? basisUnit(p, w.basis) : s.error ? 'failed' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted tiny">Prices from {ago(oldest)}</p>
            </>
          );
        }
        return (
          <div key={w.termKey} className="panel watch">
            <div className="row-between">
              <Link to={link}>
                <strong>{w.term}</strong>
              </Link>
              <button
                type="button"
                className="icon-button"
                onClick={async () => {
                  await api.unwatchPrice(w.termKey);
                  setItems((list) => list?.filter((x) => x.termKey !== w.termKey) ?? null);
                }}
                aria-label="Stop watching"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            {(w.includeWords || w.excludeWords) && (
              <p className="muted tiny">
                {w.includeWords && <>with “{w.includeWords}” </>}
                {w.excludeWords && <>without “{w.excludeWords}”</>}
              </p>
            )}
            {body}
          </div>
        );
      })}
    </div>
  );
}
