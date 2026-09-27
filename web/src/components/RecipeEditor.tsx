import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, uploadUrl } from '../api/client';
import { Recipe, RecipeDraft } from '../types';
import Icon from './Icon';
import { shrinkPhoto } from '../utils/photo';

// Ingredients and steps are edited as plain text, one per line — the fastest
// way to fix up an import or type in Gran's recipe card. A line ending in a
// colon ("For the sauce:") starts a section.

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
  const [ingredients, setIngredients] = useState(toText(initial.ingredients, (i) => i.raw));
  const [steps, setSteps] = useState(toText(initial.steps, (s) => s.text));
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(initial.image_url ?? null);
  const [removeImage, setRemoveImage] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      ingredients: fromText(ingredients).map((r) => ({ section: r.section, raw: r.line })),
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

      <div className="editor-columns">
        <label className="field">
          <span className="label">Ingredients</span>
          <span className="hint">One per line, e.g. “2 cups flour”. A line ending in “:” starts a section.</span>
          <textarea
            rows={14}
            value={ingredients}
            onChange={(e) => setIngredients(e.target.value)}
            placeholder={'500 g beef mince\n1 large onion, chopped\n2 tsp curry powder\n\nTopping:\n2 eggs\n250 ml milk'}
          />
        </label>
        <label className="field">
          <span className="label">Method</span>
          <span className="hint">One step per line.</span>
          <textarea
            rows={14}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={'Heat the oven to 180 °C.\nFry the onion until soft.\nAdd the mince and brown.'}
          />
        </label>
      </div>

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
