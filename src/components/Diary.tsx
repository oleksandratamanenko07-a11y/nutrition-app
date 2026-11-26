import { useEffect, useState } from 'react';
import { t } from '../i18n/uk';
import { copyEntries, createTemplate, deleteEntry, getDay, updateEntry, type Entry, type Meal } from '../lib/api';
import { portion } from '../lib/calc';
import { entryPortion, fmtG, fmtKcal, totals } from '../lib/day';
import { AddFlow } from './AddFlow';
import { localDate } from '../lib/telegram';
import { EXTRA_KEYS, EXTRA_FIELD, extraValue } from '../lib/extras';
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

      <p className="muted small">
        {EXTRA_KEYS.map((k, i) => {
          const per = entry[EXTRA_FIELD[k]];
          return (
            <span key={k}>
              {i > 0 ? ' · ' : ''}
              {t.extras[k]} {per === null || per === undefined ? t.extras.notSpecified : `${fmtG(per)} ${t.home.g}`}
            </span>
          );
        })}
        {validGrams && g !== null && EXTRA_KEYS.some((k) => extraValue({ ...entry, amount_g: g }, k) !== null) && (
          <>
            <br />
            {t.extras.perPortion}:{' '}
            {EXTRA_KEYS.map((k) => {
              const v = extraValue({ ...entry, amount_g: g }, k);
              return `${t.extras[k]} ${v === null ? t.extras.notSpecified : `${fmtG(v)} ${t.home.g}`}`;
            }).join(' · ')}
          </>
        )}
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

function shiftDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

/** Копіювання дня або одного прийому їжі з іншого дня. Перед копіюванням показуємо, що саме буде додано. */
function CopySheet({
  date,
  target,
  current,
  onClose,
  onDone,
}: {
  date: string;
  /** null — копіюємо весь день; інакше — у цей прийом їжі */
  target: Meal | null;
  current: Entry[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [from, setFrom] = useState(shiftDate(date, -1));
  const [srcMeal, setSrcMeal] = useState<Meal>(target ?? 'breakfast');
  const [source, setSource] = useState<Entry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const validFrom = /^\d{4}-\d{2}-\d{2}$/.test(from) && from <= date;
  const sameSpot = from === date && (target === null || srcMeal === target);

  useEffect(() => {
    if (!validFrom) {
      setSource(null);
      return;
    }
    let cancelled = false;
    setSource(null);
    setLoadFailed(false);
    getDay(from)
      .then((d) => {
        if (!cancelled) setSource(d.entries);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [from, validFrom]);

  const picked = source ? (target ? source.filter((e) => e.meal === srcMeal) : source) : null;
  const sum = picked ? totals(picked) : null;
  const hasTarget = target ? current.some((e) => e.meal === target) : current.length > 0;

  async function copy() {
    if (saving || !picked || picked.length === 0 || sameSpot) return;
    setSaving(true);
    setError('');
    try {
      await copyEntries({
        date,
        from_date: from,
        ...(target ? { from_meal: srcMeal, to_meal: target } : {}),
      });
      await onDone();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Sheet title={target ? `${t.quick.copyMealTitle}: ${t.meals[target]}` : t.quick.copyTitle} onClose={onClose}>
      <span className="muted small">{t.quick.fromDay}</span>
      <div className="segmented">
        <button type="button" className={from === shiftDate(date, -1) ? 'active' : ''} onClick={() => setFrom(shiftDate(date, -1))}>
          {t.quick.yesterday}
        </button>
        <button type="button" className={from === shiftDate(date, -7) ? 'active' : ''} onClick={() => setFrom(shiftDate(date, -7))}>
          {t.quick.weekAgo}
        </button>
      </div>
      <label className="field">
        <span>{t.quick.pickDate}</span>
        <input type="date" value={from} max={date} onChange={(e) => setFrom(e.target.value)} />
      </label>

      {target && (
        <label className="field">
          <span>{t.quick.fromMeal}</span>
          <MealPicker value={srcMeal} onChange={setSrcMeal} />
        </label>
      )}

      {loadFailed && <p className="error">{t.quick.loadError}</p>}
      {sameSpot && <p className="muted">{t.quick.sameDay}</p>}
      {!sameSpot && picked && picked.length === 0 && <p className="muted">{t.quick.nothingToCopy}</p>}
      {!sameSpot && picked && picked.length > 0 && sum && (
        <>
          <h3 className="subhead">
            {t.quick.willCopy}: {fmtKcal(sum.kcal)} {t.home.kcal}
          </h3>
          {picked.map((e) => (
            <div className="row" key={e.id}>
              <span>
                {e.name}
                {!target && <span className="muted small"> · {t.meals[e.meal]}</span>}
              </span>
              <b>{fmtG(e.amount_g)} г</b>
            </div>
          ))}
          {hasTarget && <p className="muted small">{t.quick.alreadyHas}</p>}
        </>
      )}
      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="primary"
        disabled={saving || sameSpot || !picked || picked.length === 0}
        onClick={() => void copy()}
      >
        {saving ? t.quick.copying : t.quick.doCopy}
      </button>
    </Sheet>
  );
}

/** Збереження прийому їжі як комбінації для швидкого додавання */
function SaveComboSheet({ date, meal, onClose }: { date: string; meal: Meal; onClose: () => void }) {
  const [name, setName] = useState(t.meals[meal]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const valid = name.trim().length >= 1 && name.trim().length <= 60;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await createTemplate({ name: name.trim(), date, meal });
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    }
    setSaving(false);
  }

  return (
    <Sheet title={t.quick.saveComboTitle} onClose={onClose}>
      {saved ? (
        <>
          <p>{t.quick.comboSaved}</p>
          <button type="button" className="primary" onClick={onClose}>
            {t.quick.done}
          </button>
        </>
      ) : (
        <>
          <label className="field">
            <span>{t.quick.comboName}</span>
            <input
              value={name}
              maxLength={60}
              placeholder={t.quick.comboNamePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="muted small">{t.quick.comboNote}</p>
          {error && <p className="error">{error}</p>}
          <button type="button" className="primary" disabled={!valid || saving} onClick={() => void save()}>
            {saving ? t.quick.saving : t.quick.save}
          </button>
        </>
      )}
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
  const [copying, setCopying] = useState<{ target: Meal | null } | null>(null);
  const [savingCombo, setSavingCombo] = useState<Meal | null>(null);

  async function saved() {
    setAdding(null);
    setEditing(null);
    setCopying(null);
    await reload(true);
  }

  return (
    <>
      <button type="button" className="secondary wide" onClick={() => setCopying({ target: null })}>
        📋 {t.quick.copyDay}
      </button>
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
            <div className="meal-tools">
              <button type="button" onClick={() => setCopying({ target: meal })}>
                📋 {t.quick.copyMeal}
              </button>
              {items.length > 0 && (
                <button type="button" onClick={() => setSavingCombo(meal)}>
                  ⭐ {t.quick.saveCombo}
                </button>
              )}
            </div>
          </section>
        );
      })}

      {adding && (
        <AddFlow meal={adding} date={date} onClose={() => setAdding(null)} onSaved={saved} />
      )}
      {copying && (
        <CopySheet
          date={date}
          target={copying.target}
          current={entries}
          onClose={() => setCopying(null)}
          onDone={saved}
        />
      )}
      {savingCombo && <SaveComboSheet date={date} meal={savingCombo} onClose={() => setSavingCombo(null)} />}
      {editing && <EditSheet entry={editing} onClose={() => setEditing(null)} onSaved={saved} />}
    </>
  );
}
