import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n/uk';
import { ApiError, getDay, type Day, type Entry, type Meal } from './api';
import { portion, round1, sum, type Per100 } from './calc';

/** КБЖУ порції запису: значення на 100 г із запису × грами. */
export function entryPortion(e: Entry): Per100 {
  return portion(
    { kcal: e.kcal_100, protein: e.protein_100, fat: e.fat_100, carbs: e.carbs_100 },
    e.amount_g,
  );
}

/** Сума записів без проміжного округлення. */
export function totals(entries: Entry[]): Per100 {
  return sum(entries.map(entryPortion));
}

/** Приймання їжі за замовчуванням — за часом доби */
export function defaultMeal(): Meal {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

export const fmtKcal = (x: number) => Math.round(x).toLocaleString('uk-UA');
export const fmtG = (x: number) =>
  round1(x).toLocaleString('uk-UA', { maximumFractionDigits: 1 });

/** Завантаження даних за день. Після будь-якої зміни викликайте reload(true). */
export function useDay(date: string) {
  const [day, setDay] = useState<Day | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const reload = useCallback(
    async (silent = false) => {
      const id = ++seq.current;
      if (!silent) {
        setLoading(true);
        setDay(null);
      }
      try {
        const d = await getDay(date);
        if (id !== seq.current) return;
        setDay(d);
        setError('');
      } catch (e) {
        if (id !== seq.current) return;
        setError(t.errors[e instanceof ApiError ? e.kind : 'server']);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // Після повернення інтернету оновлюємо дані
  useEffect(() => {
    const onOnline = () => void reload(true);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [reload]);

  return { day, loading, error, reload };
}
