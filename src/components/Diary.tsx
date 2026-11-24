import { useState, type ReactNode } from 'react';
import { t } from '../i18n/uk';
import { addEntry, ApiError, deleteEntry, updateEntry, type Entry, type Meal } from '../lib/api';
import { portion } from '../lib/calc';
import { entryPortion, fmtG, fmtKcal, totals } from '../lib/day';

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function parseNum(v: string): number | null {
  const s = v.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function ok(v: number | null, min: number, max: number): v is number {
  return v !== null && v >= min && v <= max;
}

function errorText(e: unknown): string {
  return t.errors[e instanceof ApiError ? e.kind : 'server'];
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label={t.diary.close}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MealPicker({ value, onChange }: { value: Meal; onChange: (m: Meal) => void }) {
  return (
    <div className="segmented">
      {MEALS.map((m) => (
        <button
          key={m}
          type="button"
          className={value === m ? 'active' : ''}
          onClick={() => onChange(m)}
        >
          {t.meals[m]}
        </button>
      ))}
    </div>
  );
}

function AddSheet({
  meal: initialMeal,
  date,
  onClose,
  onSaved,
}: {
  meal: Meal;
  date: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [grams, setGrams] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const k = parseNum(kcal);
  const p = parseNum(protein);
  const f = parseNum(fat);
  const c = parseNum(carbs);
  const g = parseNum(grams);
  const data =
    name.trim() !== '' && ok(k, 0, 900) && ok(p, 0, 100) && ok(f, 0, 100) && ok(c, 0, 100) && ok(g, 0.01, 5000)
      ? { k, p, f, c, g }
      : null;
  const sumTooBig = data !== null && data.p + data.f + data.c > 105;
  const preview =
    data !== null && !sumTooBig
      ? portion({ kcal: data.k, protein: data.p, fat: data.f, carbs: data.c }, data.g)
      : null;

  async function submit() {
    setTouched(true);
    if (!data || sumTooBig || saving) return;
    setSaving(true);
    setError('');
    try {
      await addEntry({
        date,
        meal,
        name: name.trim(),
        amount_g: data.g,
        kcal_100: data.k,
        protein_100: data.p,
        fat_100: data.f,
        carbs_100: data.c,
      });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Sheet title={t.diary.addTitle} onClose={onClose}>
      <label className="field">
        <span>{t.diary.meal}</span>
        <MealPicker value={meal} onChange={setMeal} />
      </label>

      <label className="field">
        <span>{t.diary.name}</span>
        <input
          value={name}
          maxLength={120}
          placeholder={t.diary.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <p className="muted small">
        {t.diary.per100}. {t.diary.per100Hint}
      </p>
      <div className="grid2">
        <label className="field">
          <span>{t.diary.kcal}</span>
          <input inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} />
        </label>
        <label className="field">
          <span>{t.diary.protein}</span>
          <input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
        </label>
        <label className="field">
          <span>{t.diary.fat}</span>
          <input inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
        </label>
        <label className="field">
          <span>{t.diary.carbs}</span>
          <input inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span>{t.diary.grams}</span>
        <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
      </label>

      {preview && (
        <p className="preview">
          {t.diary.total}: <b>{fmtKcal(preview.kcal)} {t.home.kcal}</b> · {t.diary.p} {fmtG(preview.protein)} ·{' '}
          {t.diary.f} {fmtG(preview.fat)} · {t.diary.c} {fmtG(preview.carbs)}
        </p>
      )}
      {sumTooBig && <p className="error">{t.diary.macroSum}</p>}
      {touched && !data && <p className="error">{t.diary.fillAll}</p>}
      {error && <p className="error">{error}</p>}

      <button type="button" className="primary" disabled={saving} onClick={() => void submit()}>
        {saving ? t.diary.saving : t.diary.addButton}
      </button>
    </Sheet>
  );
}

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
        <AddSheet meal={adding} date={date} onClose={() => setAdding(null)} onSaved={saved} />
      )}
      {editing && <EditSheet entry={editing} onClose={() => setEditing(null)} onSaved={saved} />}
    </>
  );
}
