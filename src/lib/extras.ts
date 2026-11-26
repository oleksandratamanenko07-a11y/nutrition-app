/**
 * Клітковина, цукор і сіль — окремо від КБЖУ. Без імпортів (перевіряється в scripts/selftest.mjs).
 * Дані необов'язкові: якщо у продукту значення не вказано, воно НЕ вважається нулем.
 * Підсумок дня тому показує, для скількох записів дані відомі.
 */

export type ExtraKey = 'fiber' | 'sugar' | 'salt';
export const EXTRA_KEYS: ExtraKey[] = ['fiber', 'sugar', 'salt'];
export const EXTRA_FIELD = { fiber: 'fiber_100', sugar: 'sugar_100', salt: 'salt_100' } as const;

export interface ExtraEntry {
  id: string;
  name: string;
  meal: string;
  amount_g: number;
  fiber_100?: number | null;
  sugar_100?: number | null;
  salt_100?: number | null;
  recipe_snapshot?: unknown[] | null;
}

// Та сама формула, що й calc.portion: «значення на 100 г × грами / 100» у цілих сотих.
const scaled = (per100: number, grams: number) => (Math.round(per100 * 100) * Math.round(grams * 100)) / 1e6;

/** Скільки грамів показника в порції запису; null — у продукту не вказано */
export function extraValue(e: ExtraEntry, k: ExtraKey): number | null {
  const v = e[EXTRA_FIELD[k]];
  return v === null || v === undefined ? null : scaled(v, e.amount_g);
}

export interface ExtraTotal {
  /** Сума за записами, де дані є */
  value: number;
  /** Записів із даними */
  known: number;
  /** Записів без даних */
  missing: number;
  count: number;
}

export function extrasTotal(entries: ExtraEntry[], k: ExtraKey): ExtraTotal {
  let value = 0;
  let known = 0;
  for (const e of entries) {
    const v = extraValue(e, k);
    if (v !== null) {
      value += v;
      known += 1;
    }
  }
  return { value, known, missing: entries.length - known, count: entries.length };
}

export interface ExtraRow {
  id: string;
  name: string;
  meal: string;
  amount_g: number;
  /** null — не вказано */
  value: number | null;
  isDish: boolean;
}

/** Внесок кожного запису. Спершу ті, де дані є (від більшого), потім «не вказано». Сума в порядку записів — як extrasTotal. */
export function extrasBreakdown(entries: ExtraEntry[], k: ExtraKey): { rows: ExtraRow[]; total: ExtraTotal } {
  const rows: ExtraRow[] = entries.map((e) => ({
    id: e.id,
    name: e.name,
    meal: e.meal,
    amount_g: e.amount_g,
    value: extraValue(e, k),
    isDish: !!e.recipe_snapshot && e.recipe_snapshot.length > 0,
  }));
  rows.sort((a, b) => (a.value === null ? 1 : 0) - (b.value === null ? 1 : 0) || (b.value ?? 0) - (a.value ?? 0));
  return { rows, total: extrasTotal(entries, k) };
}

export type Zone = 'low' | 'ok' | 'high';

export interface Reference {
  /** min — треба набрати щонайменше (клітковина); max — не перевищувати (цукор, сіль) */
  kind: 'min' | 'max';
  amount: number;
}

/** Довідкові орієнтири для дорослих: клітковина від 25 г (EFSA), сіль до 5 г (ВООЗ), цукор до 10 % калорій (ВООЗ) */
export const FIBER_MIN_G = 25;
export const SALT_MAX_G = 5;
export const SUGAR_ENERGY_SHARE = 0.1;

export function referenceFor(k: ExtraKey, kcalGoal: number | null): Reference {
  if (k === 'fiber') return { kind: 'min', amount: FIBER_MIN_G };
  if (k === 'salt') return { kind: 'max', amount: SALT_MAX_G };
  const kcal = kcalGoal && kcalGoal > 0 ? kcalGoal : 2000;
  return { kind: 'max', amount: Math.round((kcal * SUGAR_ENERGY_SHARE) / 4) }; // 4 ккал на 1 г цукру
}

/**
 * Зона для кольору. Якщо дані неповні, висновок робимо лише там, де він певний:
 *  - ліміт (цукор, сіль) уже перевищено — «high», навіть якщо дані неповні;
 *  - клітковина вже досягла орієнтиру — «ok»;
 *  - в інших випадках за неповних даних — null (колір не ставимо, щоб не вводити в оману).
 */
export function extraZone(total: ExtraTotal, ref: Reference): Zone | null {
  if (total.count === 0 || total.known === 0) return null;
  const complete = total.missing === 0;
  const pct100 = (total.value * 10000) / ref.amount;
  if (ref.kind === 'max') {
    if (pct100 > 10000 + 1e-9) return 'high';
    return complete ? 'ok' : null;
  }
  if (pct100 >= 10000 - 1e-9) return 'ok';
  if (!complete) return null;
  return pct100 < 9000 - 1e-9 ? 'low' : 'ok';
}

/** Відсоток від орієнтиру для показу, 0 і більше */
export function extraPct(total: ExtraTotal, ref: Reference): number {
  return ref.amount > 0 ? Math.round((total.value / ref.amount) * 100) : 0;
}
