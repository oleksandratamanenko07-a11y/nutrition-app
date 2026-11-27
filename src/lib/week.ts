/** Дані для графіка «Останні 7 днів» (без імпортів — перевіряється в scripts/selftest.mjs). */

export function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** n останніх дат, що закінчуються сьогодні, від давніших до новіших */
export function lastDates(today: string, n = 7): string[] {
  return Array.from({ length: n }, (_, i) => addDaysStr(today, i - (n - 1)));
}

export interface WeekDay {
  date: string;
  /** Ккал за день; null — записів у цей день немає */
  kcal: number | null;
  goal: number;
}

/** Середнє лише за дні із записами: порожній день не рахується нулем */
export function weekAverage(days: WeekDay[]): number | null {
  const v = days.filter((d) => d.kcal !== null).map((d) => d.kcal as number);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
}

/** Верх шкали: найбільше з калорій і цілей, з невеликим запасом */
export function scaleMax(days: WeekDay[]): number {
  const m = Math.max(0, ...days.map((d) => Math.max(d.kcal ?? 0, d.goal)));
  return m > 0 ? m * 1.08 : 1;
}

/** Висота стовпчика в пікселях; порожній день — тонка риска */
export function barPx(kcal: number | null, max: number, maxPx: number, minPx = 3): number {
  if (kcal === null) return minPx;
  return Math.max(minPx, Math.round((kcal / max) * maxPx));
}
