import { FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { Category, GrocyImportResult, ShoppingList, Staple } from '../types';
import Icon from '../components/Icon';
import { AiAssistants, BudgetProSettings } from '../components/AiSettings';

export default function Settings() {
  const location = useLocation();
  useEffect(() => {
    const id = location.hash.replace('#', '');
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [location.hash]);

  return (
    <div className="settings">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <AiAssistants />
      <BudgetProSettings />
      <Aisles />
      <Staples />
      <Lists />
      <GrocyImport />
    </div>
  );
}

function Aisles() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCategories().then(setCategories).catch((e) => setError(e.message));
  }, []);

  async function move(index: number, delta: number) {
    const next = [...categories];
    const [c] = next.splice(index, 1);
    next.splice(index + delta, 0, c);
    setCategories(next);
    setCategories(await api.reorderCategories(next.map((x) => x.id)));
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const c = await api.createCategory(name.trim());
    setCategories((cs) => [...cs, c]);
    setName('');
  }

  async function rename(c: Category, value: string) {
    if (!value.trim() || value.trim() === c.name) return;
    const updated = await api.renameCategory(c.id, value.trim());
    setCategories((cs) => cs.map((x) => (x.id === c.id ? updated : x)));
  }

  async function remove(c: Category) {
    if (!confirm(`Delete the “${c.name}” aisle? Items in it move to Other.`)) return;
    await api.deleteCategory(c.id);
    setCategories((cs) => cs.filter((x) => x.id !== c.id));
  }

  return (
    <section className="panel">
      <h2>Aisles</h2>
      <p className="muted small">The shopping list is grouped by these, in this order — arrange them the way you walk through your shop.</p>
      {error && <p className="error">{error}</p>}
      <ul className="order-list">
        {categories.map((c, i) => (
          <li key={c.id}>
            <input defaultValue={c.name} onBlur={(e) => rename(c, e.target.value)} aria-label="Aisle name" />
            <button type="button" className="icon-button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              <Icon name="up" />
            </button>
            <button type="button" className="icon-button" disabled={i === categories.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              <Icon name="down" />
            </button>
            <button type="button" className="icon-button danger" onClick={() => remove(c)} aria-label="Delete">
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New aisle" />
        <button type="submit" className="button secondary">
          Add
        </button>
      </form>
    </section>
  );
}

function Staples() {
  const [staples, setStaples] = useState<Staple[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    api.listStaples().then(setStaples).catch(() => setStaples([]));
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.addStaple(name.trim());
    setStaples(await api.listStaples());
    setName('');
  }

  async function remove(s: Staple) {
    await api.deleteStaple(s.name_key);
    setStaples((ss) => ss.filter((x) => x.name_key !== s.name_key));
  }

  return (
    <section className="panel">
      <h2>Pantry staples</h2>
      <p className="muted small">
        Things you always have. When a recipe's ingredients go to the shopping list, these start unticked.
      </p>
      <div className="chip-row">
        {staples.map((s) => (
          <span key={s.name_key} className="chip removable">
            {s.name}
            <button type="button" onClick={() => remove(s)} aria-label={`Remove ${s.name}`}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
      </div>
      <form className="inline-form" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Flour" />
        <button type="submit" className="button secondary">
          Add
        </button>
      </form>
    </section>
  );
}

function Lists() {
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = () => api.listShoppingLists().then(setLists).catch((e) => setError(e.message));
  useEffect(() => {
    reload();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createShoppingList(name.trim());
    setName('');
    reload();
  }

  async function rename(l: ShoppingList, value: string) {
    if (!value.trim() || value.trim() === l.name) return;
    await api.renameShoppingList(l.id, value.trim());
    reload();
  }

  async function remove(l: ShoppingList) {
    if (!confirm(`Delete the “${l.name}” list and everything on it?`)) return;
    try {
      await api.deleteShoppingList(l.id);
      reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <section className="panel">
      <h2>Shopping lists</h2>
      <p className="muted small">Keep separate lists if you like — e.g. one for groceries, one for Makro runs.</p>
      {error && <p className="error">{error}</p>}
      <ul className="order-list">
        {lists.map((l) => (
          <li key={l.id}>
            <input defaultValue={l.name} onBlur={(e) => rename(l, e.target.value)} aria-label="List name" />
            <span className="muted small nowrap">{l.open_count} open</span>
            <button type="button" className="icon-button danger" onClick={() => remove(l)} disabled={lists.length <= 1} aria-label="Delete">
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list" />
        <button type="submit" className="button secondary">
          Add
        </button>
      </form>
    </section>
  );
}

function GrocyImport() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [what, setWhat] = useState({ recipes: true, shopping: true, mealplan: true, products: true });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GrocyImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.importGrocy({ url, api_key: key, ...what }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const options: [keyof typeof what, string][] = [
    ['recipes', 'Recipes (with pictures)'],
    ['shopping', 'Open shopping list items'],
    ['mealplan', 'Meal plan'],
    ['products', 'Products and their barcodes (for autocomplete, aisles and scanning)'],
  ];

  return (
    <section className="panel" id="grocy">
      <h2>Import from Grocy</h2>
      <p className="muted small">
        Copies your Grocy recipes, shopping list and meal plan into KitchenAid. Grocy itself isn't changed, and running it again only
        brings over what's new. Use Grocy's own port — e.g. <code>http://&lt;your-HA-IP&gt;:9192</code> — not the Home Assistant sidebar
        link. Create an API key in Grocy under <em>Settings → Manage API keys</em>; it's used once and not stored.
      </p>
      <form onSubmit={run} className="grocy-form">
        <div className="field-grid two">
          <label className="field">
            <span className="label">Grocy address</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:9192" required />
          </label>
          <label className="field">
            <span className="label">API key</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" required />
          </label>
        </div>
        <div className="checks">
          {options.map(([k, label]) => (
            <label key={k}>
              <input type="checkbox" checked={what[k]} onChange={(e) => setWhat((w) => ({ ...w, [k]: e.target.checked }))} /> {label}
            </label>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        {result && (
          <div className="notice">
            Brought over {result.recipes} recipe{result.recipes === 1 ? '' : 's'}, {result.shopping_items} shopping item
            {result.shopping_items === 1 ? '' : 's'}, {result.meal_plan} planned meal{result.meal_plan === 1 ? '' : 's'} and{' '}
            {result.products} product name{result.products === 1 ? '' : 's'} with {result.barcodes} barcode{result.barcodes === 1 ? '' : 's'}.
            {result.skipped > 0 && ` ${result.skipped} already imported earlier were skipped.`}
            {result.warnings.map((w) => (
              <div key={w} className="small">
                {w}
              </div>
            ))}
          </div>
        )}
        <div className="form-actions">
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </form>
    </section>
  );
}
