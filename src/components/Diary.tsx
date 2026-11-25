import { useState, type ReactNode } from 'react';
import { t } from '../i18n/uk';
import { deleteEntry, updateEntry, type Entry, type Meal } from '../lib/api';
import { portion } from '../lib/calc';
import { entryPortion, fmtG, fmtKcal, totals } from '../lib/day';
import { AddFlow } from './AddFlow';
import { errorText, MEALS, MealPicker, ok, parseNum, Sheet } from './ui';

function EditSheet({
  entry,
  onClose,
  onSaved,
}: {
  entry: Entry;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [grams, setGrams] = useState(String(entry.amount_g));
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const g = parseNum(grams);
  const validGrams = ok(g, 0.01, 5000);
  const preview = validGrams
    ? portion(
        { kcal: entry.kcal_100, protein: entry.protein_100, fat: entry.fat_100, carbs: entry.carbs_100 },
        g,
      )
    : null;

  async function save() {
    if (!validGrams || saving) return;
    const patch: { amount_g?: number; meal?: Meal } = {};
    if (g !== entry.amount_g) patch.amount_g = g;
    if (meal !== entry.meal) patch.meal = meal;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateEntry(entry.id, patch);
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  async function remove() {
    if (saving) return;
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await deleteEntry(entry.id);
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Sheet title={t.diary.editTitle} onClose={onClose}>
      <p className="entry-title">{entry.name}</p>
      <p className="muted small">
        {t.diary.per100}: {fmtKcal(entry.kcal_100)} {t.home.kcal} · {t.diary.p} {fmtG(entry.protein_100)} ·{' '}
        {t.diary.f} {fmtG(entry.fat_100)} · {t.diary.c} {fmtG(entry.carbs_100)}
      </p>

      {entry.recipe_snapshot && entry.recipe_snapshot.length > 0 && (
        <>
          <h3 className="subhead">{t.dishes.snapshotTitle}</h3>
          {entry.recipe_snapshot.map((i, idx) => (
            <div className="row" key={idx}>
              <span>{i.name}</span>
              <b>{fmtG(i.amount_g)} г</b>
            </div>
          ))}
        </>
      )}

      <label className="field">
        <span>{t.diary.grams}</span>
        <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
      </label>

      <label className="field">
        <span>{t.diary.moveTo}</span>
        <MealPicker value={meal} onChange={setMeal} />
      </label>

      {preview && (
        <p className="preview">
          {t.diary.total}: <b>{fmtKcal(preview.kcal)} {t.home.kcal}</b> · {t.diary.p} {fmtG(preview.protein)} ·{' '}
          {t.diary.f} {fmtG(preview.fat)} · {t.diary.c} {fmtG(preview.carbs)}
        </p>
      )}
      {!validGrams && <p className="error">{t.diary.fillAll}</p>}
      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="primary"
        disabled={saving || !validGrams}
        onClick={() => void save()}
      >
        {saving ? t.diary.saving : t.diary.saveChanges}
      </button>
      <button type="button" className="danger" disabled={saving} onClick={() => void remove()}>
        {confirm ? t.diary.confirmRemove : t.diary.remove}
      </button>
    </Sheet>
  );
}

export function Diary({
  date,
  entries,
  reload,
}: {
  date: string;
  entries: Entry[];
  reload: (silent?: boolean) => Promise<void>;
}) {
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);

  async function saved() {
    setAdding(null);
    setEditing(null);
    await reload(true);
  }

  return (
    <>
      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal);
        const sum = totals(items);
        return (
          <section className="card" key={meal}>
            <div className="meal-head">
              <h2>{t.meals[meal]}</h2>
              <span className="muted">
                {fmtKcal(sum.kcal)} {t.home.kcal}
              </span>
            </div>

            {items.length === 0 && <p className="muted small">{t.diary.empty}</p>}

            {items.map((e) => {
              const p = entryPortion(e);
              return (
                <button type="button" className="entry" key={e.id} onClick={() => setEditing(e)}>
                  <span className="entry-main">
                    <span className="entry-name">{e.name}</span>
                    <span className="muted small">
                      {fmtG(e.amount_g)} г · {t.diary.p} {fmtG(p.protein)} · {t.diary.f} {fmtG(p.fat)} · {t.diary.c}{' '}
                      {fmtG(p.carbs)}
                    </span>
                  </span>
                  <span className="entry-kcal">{fmtKcal(p.kcal)}</span>
                </button>
              );
            })}

            <button type="button" className="add" onClick={() => setAdding(meal)}>
              + {t.diary.add}
            </button>
          </section>
        );
      })}

      {adding && (
        <AddFlow meal={adding} date={date} onClose={() => setAdding(null)} onSaved={saved} />
      )}
      {editing && <EditSheet entry={editing} onClose={() => setEditing(null)} onSaved={saved} />}
    </>
  );
}
