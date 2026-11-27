import { useEffect, useState } from 'react';
import { t } from '../i18n/uk';
import { addEntry, frequentFoods, getRange, type Entry, type FrequentFood, type Meal } from '../lib/api';
import { goalStatus } from '../lib/calc';
import { defaultMeal, fmtKcal, totals } from '../lib/day';
import { goalForDate } from '../lib/history';
import { barPx, lastDates, scaleMax, weekAverage, type WeekDay } from '../lib/week';
import { errorText, MEALS, Sheet } from './ui';

const MEAL_ICON: Record<Meal, string> = { breakfast: '🍳', lunch: '🍲', dinner: '🍽', snack: '🍎' };

/** Меню кнопки «+»: який прийом їжі додаємо */
export function MealMenu({
  entries,
  isToday,
  onPick,
  onClose,
}: {
  entries: Entry[];
  isToday: boolean;
  onPick: (m: Meal) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={t.home.addTitle} onClose={onClose}>
      <p className="muted small">{t.home.addHint}</p>
      {MEALS.map((m) => {
        const items = entries.filter((e) => e.meal === m);
        const kcal = totals(items).kcal;
        const sub =
          items.length === 0
            ? t.home.mealNone
            : (isToday ? t.home.mealToday : t.home.mealDay).replace('{n}', fmtKcal(kcal));
        return (
          <button type="button" className="mealrow" key={m} onClick={() => onPick(m)}>
            <span className="mealrow-ic" aria-hidden="true">
              {MEAL_ICON[m]}
            </span>
            <span className="mealrow-t">
              <b>{t.meals[m]}</b>
              <span className="muted small">{sub}</span>
            </span>
            <span className="mealrow-go" aria-hidden="true">
              ›
            </span>
          </button>
        );
      })}
    </Sheet>
  );
}

/** Стрічка частих продуктів: тап додає останню використану кількість у прийом їжі за часом доби */
export function QuickAddStrip({
  date,
  refreshKey,
  onAdded,
}: {
  date: string;
  refreshKey: unknown;
  onAdded: () => Promise<void>;
}) {
  const [items, setItems] = useState<FrequentFood[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState('');
  const meal = defaultMeal();

  useEffect(() => {
    let cancelled = false;
    frequentFoods()
      .then((r) => {
        if (!cancelled) setItems(r.filter((f) => f.kcal_100 !== null && f.protein_100 !== null && f.fat_100 !== null && f.carbs_100 !== null).slice(0, 10));
      })
      .catch(() => undefined); // необов'язковий блок: без нього просто не показуємо
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (items.length === 0) return null;

  async function add(f: FrequentFood) {
    const key = f.id ?? f.name;
    if (busy) return;
    setBusy(key);
    setError('');
    try {
      await addEntry({
        date,
        meal,
        name: f.name,
        amount_g: f.last_amount_g,
        kcal_100: f.kcal_100!,
        protein_100: f.protein_100!,
        fat_100: f.fat_100!,
        carbs_100: f.carbs_100!,
        barcode: f.barcode,
        brand: f.brand,
        country: f.country,
        image_url: f.image_url,
        fiber_100: f.fiber_100 ?? null,
        sugar_100: f.sugar_100 ?? null,
        salt_100: f.salt_100 ?? null,
      });
      await onAdded();
      setDone(key);
      setTimeout(() => setDone((d) => (d === key ? null : d)), 1500);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="quick-add">
      <div className="quick-head">
        <h2>{t.home.quickTitle}</h2>
        <span className="muted small">{t.home.quickHint.replace('{meal}', t.meals[meal].toLowerCase())}</span>
      </div>
      <div className="quick-chips">
        {items.map((f) => {
          const key = f.id ?? f.name;
          return (
            <button type="button" key={key} className="quick-chip" disabled={busy !== null} onClick={() => void add(f)}>
              <span className="quick-name">{f.name}</span>
              <b>{done === key ? '✓' : '+'}</b>
            </button>
          );
        })}
      </div>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

const BAR_MAX_PX = 70;

/** Графік калорій за 7 днів, що закінчуються сьогодні; колір — за тими самими зонами, що й на головній */
export function WeekChart({ today, kcalGoal, refreshKey }: { today: string; kcalGoal: number; refreshKey: unknown }) {
  const [days, setDays] = useState<WeekDay[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const dates = lastDates(today, 7);
    getRange(dates[0], today)
      .then(({ entries, goals }) => {
        if (cancelled) return;
        setDays(
          dates.map((date) => {
            const es = entries.filter((e) => e.entry_date === date);
            return {
              date,
              kcal: es.length === 0 ? null : totals(es).kcal,
              goal: goalForDate(goals, date)?.kcal_goal ?? kcalGoal,
            };
          }),
        );
      })
      .catch(() => undefined); // необов'язковий блок
    return () => {
      cancelled = true;
    };
  }, [today, kcalGoal, refreshKey]);

  if (!days) return null;
  const max = scaleMax(days);
  const avg = weekAverage(days);
  const weekday = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString('uk-UA', { weekday: 'short' });
  };

  return (
    <section className="card">
      <div className="macro-head">
        <h2>{t.home.weekTitle}</h2>
        <span className="muted small">{avg === null ? t.home.weekNoData : t.home.weekAvg.replace('{n}', fmtKcal(avg))}</span>
      </div>
      <div className="week" role="img" aria-label={t.home.weekTitle}>
        {kcalGoal > 0 && <div className="week-goal" style={{ bottom: `${20 + (kcalGoal / max) * BAR_MAX_PX}px` }} />}
        {days.map((d) => (
          <div className={`week-col ${d.kcal === null ? '' : `st-${goalStatus(d.kcal, d.goal)}`}`} key={d.date}>
            <div className={`week-bar ${d.kcal === null ? 'none' : ''}`} style={{ height: `${barPx(d.kcal, max, BAR_MAX_PX)}px` }} />
            <span className={`week-day ${d.date === today ? 'today' : ''}`}>{weekday(d.date)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
