import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, uploadUrl } from '../api/client';
import { MealPlanEntry, Slot } from '../types';
import { addDays, dayLabel, rangeLabel, today, weekStart } from '../utils/dates';
import { placeholderStyle } from '../utils/format';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import CookDialog from '../components/CookDialog';
import AddToPlanDialog, { SLOTS } from '../components/AddToPlanDialog';
import AddToListDialog from '../components/AddToListDialog';

const SLOT_ORDER: Record<Slot, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
const slotLabel = (s: Slot) => SLOTS.find((x) => x.value === s)?.label ?? s;

export default function MealPlan() {
  const [start, setStart] = useState(() => weekStart(today()));
  const end = addDays(start, 6);
  const [entries, setEntries] = useState<MealPlanEntry[] | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<MealPlanEntry | null>(null);
  const [shopping, setShopping] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.listMealPlan(start, end).then(setEntries).catch((e) => setError(e.message));
  }, [start, end]);
  useEffect(reload, [reload]);

  const loadPreview = useCallback(() => api.mealPlanShoppingPreview(start, end), [start, end]);

  async function moveTo(entryId: string, date: string) {
    const entry = entries?.find((e) => e.id === entryId);
    if (!entry || entry.date === date) return;
    setEntries((es) => es?.map((e) => (e.id === entryId ? { ...e, date } : e)) ?? null);
    try {
      await api.updateMealPlan(entryId, { date });
    } catch (e: any) {
      setError(e.message);
    }
    reload();
  }

  const days = Array.from({ length: 7 }, (_v, i) => addDays(start, i));
  const todayIso = today();
  const recipeCount = entries?.filter((e) => e.recipe_id).length ?? 0;

  return (
    <div>
      <div className="page-head">
        <h1>Meal plan</h1>
        <div className="page-actions">
          <button type="button" className="button" onClick={() => setShopping(true)} disabled={!recipeCount}>
            <Icon name="cart" /> Shop for this week
          </button>
        </div>
      </div>

      <div className="week-nav">
        <button type="button" className="icon-button bordered" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">
          <Icon name="left" />
        </button>
        <strong>{rangeLabel(start, end)}</strong>
        <button type="button" className="icon-button bordered" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">
          <Icon name="right" />
        </button>
        {start !== weekStart(todayIso) && (
          <button type="button" className="button ghost small" onClick={() => setStart(weekStart(todayIso))}>
            This week
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="week">
        {days.map((d) => {
          const label = dayLabel(d);
          const dayEntries = (entries ?? [])
            .filter((e) => e.date === d)
            .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || a.position - b.position);
          return (
            <section
              key={d}
              className={`day${d === todayIso ? ' today' : ''}${d < todayIso ? ' past' : ''}${dragOver === d ? ' drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(d);
              }}
              onDragLeave={() => setDragOver((x) => (x === d ? null : x))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                moveTo(e.dataTransfer.getData('text/plain'), d);
              }}
            >
              <div className="day-label">
                <span className="weekday">{label.weekday}</span>
                <span className="daynum">{label.day}</span>
                <span className="month">{label.month}</span>
              </div>
              <div className="day-entries">
                {dayEntries.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`meal${e.recipe_id ? '' : ' note'}`}
                    draggable
                    onDragStart={(ev) => ev.dataTransfer.setData('text/plain', e.id)}
                    onClick={() => setEditing(e)}
                  >
                    {e.recipe_id ? (
                      uploadUrl(e.image_path) ? (
                        <img src={uploadUrl(e.image_path)!} alt="" />
                      ) : (
                        <span className="thumb-placeholder" style={placeholderStyle(e.title)}>{e.title.slice(0, 1).toUpperCase()}</span>
                      )
                    ) : (
                      <span className="thumb-placeholder note">📝</span>
                    )}
                    <span className="meal-text">
                      <span className="meal-slot">{slotLabel(e.slot)}</span>
                      <span className="meal-title">{e.title}</span>
                      {e.servings && e.recipe_id && <span className="muted tiny">{e.servings} servings</span>}
                    </span>
                  </button>
                ))}
                <button type="button" className="add-meal" onClick={() => setAddingFor(d)} aria-label={`Add to ${label.weekday}`}>
                  <Icon name="plus" size={16} /> {dayEntries.length ? '' : 'Add'}
                </button>
              </div>
            </section>
          );
        })}
      </div>
      <p className="muted tiny hide-mobile">Tip: drag a meal onto another day to move it.</p>

      {addingFor && <AddToPlanDialog date={addingFor} onClose={() => setAddingFor(null)} onSaved={reload} />}
      {editing && <EntryDialog entry={editing} onClose={() => setEditing(null)} onChanged={reload} />}
      {shopping && <AddToListDialog title={`Shopping for ${rangeLabel(start, end)}`} load={loadPreview} onClose={() => setShopping(false)} />}
    </div>
  );
}

function EntryDialog({ entry, onClose, onChanged }: { entry: MealPlanEntry; onClose: () => void; onChanged: () => void }) {
  const [date, setDate] = useState(entry.date);
  const [slot, setSlot] = useState<Slot>(entry.slot);
  const [servings, setServings] = useState<number | ''>(entry.servings ?? '');
  const [cooking, setCooking] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [note, setNote] = useState(entry.note ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      await api.updateMealPlan(entry.id, {
        date,
        slot,
        servings: servings === '' ? null : servings,
        note,
        ...(entry.recipe_id ? {} : { title }),
      });
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function remove() {
    await api.deleteMealPlan(entry.id);
    onChanged();
    onClose();
  }

  return (
    <Modal
      title={entry.recipe_id ? entry.title : 'Note'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button ghost danger" onClick={remove}>
            <Icon name="trash" /> Remove
          </button>
          <span className="toolbar-spacer" />
          <button type="button" className="button" onClick={save}>
            Save
          </button>
        </>
      }
    >
      {error && <p className="error">{error}</p>}
      {entry.recipe_id && (
        <p className="button-row">
          <Link to={`/recipes/${entry.recipe_id}`} className="button secondary small">
            Open recipe
          </Link>
          <button type="button" className="button secondary small" onClick={() => setCooking(true)}>
            <Icon name="check" /> Cooked it
          </button>
        </p>
      )}
      {cooking && entry.recipe_id && <CookDialog recipeId={entry.recipe_id} servings={entry.servings} onClose={() => setCooking(false)} />}
      {!entry.recipe_id && (
        <label className="field">
          <span className="label">Note</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span className="label">Day</span>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      <div className="field">
        <span className="label">Meal</span>
        <div className="segmented">
          {SLOTS.map((s) => (
            <button key={s.value} type="button" className={slot === s.value ? 'active' : ''} onClick={() => setSlot(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {entry.recipe_id && (
        <>
          <label className="field inline">
            <span className="label">Servings</span>
            <input
              type="number"
              min={1}
              className="narrow"
              value={servings}
              onChange={(e) => setServings(e.target.value === '' ? '' : Math.max(1, Number(e.target.value)))}
            />
          </label>
          <label className="field">
            <span className="label">Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. double batch, freeze half" />
          </label>
        </>
      )}
    </Modal>
  );
}
