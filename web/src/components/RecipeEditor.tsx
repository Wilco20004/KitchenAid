import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, uploadUrl } from '../api/client';
import { Item, Recipe, RecipeDraft } from '../types';
import Icon from './Icon';
import { shrinkPhoto } from '../utils/photo';
import IngredientsEditor, { IngRow, ingredientsFromRows, Row, rowsFromIngredients, rowsFromParsed } from './IngredientsEditor';
import StepsEditor from './StepsEditor';
import { missingRefs } from '../utils/steps';

// Ingredients are rows (amount, unit, name, note, linked item, short name);
// steps stay plain text, one per line — the fastest way to fix up an import
// or type in Gran's recipe card — with {{flour}} for live amounts. A line
// ending in a colon ("For the sauce:") starts a section.

function toText<T extends { section: string | null }>(rows: T[], line: (r: T) => string): string {
  const out: string[] = [];
  let section: string | null = null;
  for (const r of rows) {
    if (r.section !== section) {
      if (r.section) out.push(`${out.length ? '\n' : ''}${r.section.replace(/:\s*$/, '')}:`);
      section = r.section;
    }
    out.push(line(r));
  }
  return out.join('\n');
}

function fromText(text: string): { section: string | null; line: string }[] {
  let section: string | null = null;
  const rows: { section: string | null; line: string }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[^\d].{0,48}:$/.test(line)) {
      section = line.slice(0, -1).trim() || null;
      continue;
    }
    rows.push({ section, line });
  }
  return rows;
}

/** "1¾", "1 1/2", "2–3" → numbers for the step preview (the server does the real reading). */
function quantityOf(text: string): { quantity: number | null; quantity_max: number | null } {
  const glyphs: Record<string, string> = { '½': ' 1/2', '⅓': ' 1/3', '⅔': ' 2/3', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8' };
  const s = text.replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, (g) => glyphs[g]).replace(',', '.').trim();
  const num = (p: string) => {
    const parts = p.trim().split(/\s+/);
    let n = 0;
    for (const x of parts) {
      const fr = x.match(/^(\d+)\/(\d+)$/);
      const v = fr ? Number(fr[1]) / Number(fr[2]) : Number(x);
      if (!Number.isFinite(v)) return null;
      n += v;
    }
    return n > 0 ? n : null;
  };
  const [a, b] = s.split(/\s*(?:-|–|—|to)\s*/);
  const quantity = a ? num(a) : null;
  return { quantity, quantity_max: quantity !== null && b ? num(b) : null };
}

const numOrNull = (s: string) => (s.trim() && Number(s) > 0 ? Math.round(Number(s)) : null);

export default function RecipeEditor({
  initial,
  recipe,
  submitLabel = 'Save recipe',
}: {
  initial: RecipeDraft;
  /** Present when editing an existing recipe. */
  recipe?: Recipe;
  submitLabel?: string;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const [servings, setServings] = useState(initial.servings?.toString() ?? '');
  const [prep, setPrep] = useState(initial.prep_minutes?.toString() ?? '');
  const [cook, setCook] = useState(initial.cook_minutes?.toString() ?? '');
  const [total, setTotal] = useState(initial.total_minutes?.toString() ?? '');
  const [sourceUrl, setSourceUrl] = useState(initial.source_url ?? '');
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [rows, setRows] = useState<Row[] | null>(recipe ? rowsFromIngredients(recipe.ingredients) : null);
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [steps, setSteps] = useState(toText(initial.steps, (s) => s.text));
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(initial.image_url ?? null);
  const [removeImage, setRemoveImage] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCatalog().then(setCatalog).catch(() => setCatalog([]));
    if (recipe) return;
    // An import or a new recipe: its lines are read into rows (with suggested items) by the server.
    const lines = initial.ingredients.map((i) => ({ section: i.section, raw: i.raw ?? '' })).filter((l) => l.raw.trim());
    if (!lines.length) return setRows([]);
    api
      .parseIngredients(lines)
      .then((parsed) => setRows(rowsFromParsed(parsed)))
      .catch((e) => {
        setError(`Couldn't read the ingredients: ${e.message}`);
        setRows([]);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Steps can use the short names of the items the ingredients are linked to.
  const refOf = new Map(catalog.filter((i) => i.ref).map((i) => [i.id, i.ref!]));
  const refIngredients = (rows ?? [])
    .filter((r): r is IngRow => r.kind === 'ing' && !!r.name.trim() && !!r.linkId && refOf.has(r.linkId))
    .map((r) => ({ ref: refOf.get(r.linkId!)!, name: r.name.trim(), unit: r.unit.trim() || null, ...quantityOf(r.amount.trim()) }));

  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (filePreview && URL.revokeObjectURL(filePreview)), [filePreview]);

  const existingImage = recipe && !removeImage ? uploadUrl(recipe.image_path) : null;
  const preview = filePreview ?? imageUrl ?? existingImage;

  async function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setFile(await shrinkPhoto(picked));
    setImageUrl(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the recipe a name');
    if (!rows) return;
    const known = new Set(refIngredients.map((r) => r.ref));
    const missing = fromText(steps).flatMap((r, n) => missingRefs(r.line, known).map((m) => `step ${n + 1}: ${m}`));
    if (missing.length)
      return setError(
        `These amounts in the method don't match a linked ingredient's short name — ${missing.join('; ')}. Link the ingredient to its item, or check the name on the item in Pantry.`
      );
    setSaving(true);
    setError(null);
    const draft: RecipeDraft = {
      name: name.trim(),
      description: description.trim() || null,
      servings: numOrNull(servings),
      prep_minutes: numOrNull(prep),
      cook_minutes: numOrNull(cook),
      total_minutes: numOrNull(total),
      source_url: sourceUrl.trim() || null,
      source_name: initial.source_name,
      notes: notes.trim() || null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      ingredients: ingredientsFromRows(rows, catalog),
      steps: fromText(steps).map((r) => ({ section: r.section, text: r.line.replace(/^\d+[.)]\s+/, '') })),
      image_url: file ? null : imageUrl,
    };
    try {
      let saved = recipe ? await api.updateRecipe(recipe.id, draft) : await api.createRecipe(draft);
      if (file) saved = await api.uploadRecipePhoto(saved.id, file);
      else if (recipe && removeImage && !imageUrl && recipe.image_path) saved = await api.deleteRecipePhoto(saved.id);
      navigate(`/recipes/${saved.id}`, { replace: true });
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="editor" onSubmit={submit}>
      <div className="editor-top">
        <div className="photo-field">
          {preview ? <img src={preview} alt="" /> : <div className="photo-empty"><Icon name="image" size={32} /></div>}
          <div className="photo-actions">
            {/* capture opens the phone's camera straight away; on a computer it's just a file picker. */}
            <label className="button secondary small">
              <Icon name="camera" size={16} /> Take photo
              <input type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
            </label>
            <label className="button secondary small">
              {preview ? 'Change photo' : 'Choose photo'}
              <input type="file" accept="image/*" hidden onChange={pickPhoto} />
            </label>
            {preview && (
              <button
                type="button"
                className="button ghost small"
                onClick={() => {
                  setFile(null);
                  setImageUrl(null);
                  setRemoveImage(true);
                }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <div className="editor-meta">
          <label className="field">
            <span className="label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bobotie" required />
          </label>
          <label className="field">
            <span className="label">Short description</span>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="field-grid">
            <label className="field">
              <span className="label">Servings</span>
              <input type="number" min={1} value={servings} onChange={(e) => setServings(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Prep (min)</span>
              <input type="number" min={0} value={prep} onChange={(e) => setPrep(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Cook (min)</span>
              <input type="number" min={0} value={cook} onChange={(e) => setCook(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Total (min)</span>
              <input type="number" min={0} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="auto" />
            </label>
          </div>
          <label className="field">
            <span className="label">Tags</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dinner, braai, quick — comma separated" />
          </label>
        </div>
      </div>

      <section className="field">
        <span className="label">Ingredients</span>
        {rows === null ? (
          <p className="muted small">Reading ingredients…</p>
        ) : (
          <IngredientsEditor rows={rows} setRows={(u) => setRows((rs) => u(rs ?? []))} catalog={catalog} />
        )}
      </section>
      <section className="field">
        <span className="label">Method</span>
        <span className="hint">
          One step per line. Write a linked ingredient's amount as its item's short name in double braces — <code>{'{{flour}}'}</code>,{' '}
          <code>{'{{flour.amount}}'}</code>, or part of it: <code>{'{{chips*1/4}}'}</code> — and it follows the servings and any change to the
          ingredient. Short names are set on the item in Pantry.
        </span>
        <StepsEditor value={steps} onChange={setSteps} ingredients={refIngredients} />
      </section>

      <label className="field">
        <span className="label">Notes</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tweaks, what to serve it with…" />
      </label>
      <label className="field">
        <span className="label">Source link</span>
        <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
      </label>

      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
