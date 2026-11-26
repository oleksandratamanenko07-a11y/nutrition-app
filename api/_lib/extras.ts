/**
 * Додаткові показники на 100 г: клітковина, цукор, сіль.
 * Необов'язкові: якщо значення немає — null («не вказано»), нуль не підставляється.
 * Файл без імпортів — перевіряється окремо (scripts/selftest.mjs).
 */

export const EXTRA_KEYS = ['fiber_100', 'sugar_100', 'salt_100'] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];
export type Extras = Record<ExtraKey, number | null>;

/** Число 0–100 з округленням до сотих; усе інше (порожньо, від'ємне, понад 100, не число) — null */
export function cleanExtra(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  if (!Number.isFinite(x) || x < 0 || x > 100) return null;
  return Math.round(x * 100) / 100;
}

/** Бере fiber_100, sugar_100, salt_100 з тіла запиту або рядка бази (числа можуть бути рядками) */
export function parseExtras(src: unknown): Extras {
  const o = (src && typeof src === 'object' ? src : {}) as Record<string, unknown>;
  return {
    fiber_100: cleanExtra(o.fiber_100),
    sugar_100: cleanExtra(o.sugar_100),
    salt_100: cleanExtra(o.salt_100),
  };
}

/** Лише відомі значення — щоб оновлення не затирало збережене порожнім */
export function knownExtras(e: Extras): Partial<Extras> {
  const out: Partial<Extras> = {};
  for (const k of EXTRA_KEYS) if (e[k] !== null) out[k] = e[k];
  return out;
}
