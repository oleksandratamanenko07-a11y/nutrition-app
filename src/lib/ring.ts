/** Відсоток від цілі для показу в центрі кільця (без імпортів — перевіряється в scripts/selftest.mjs). */
export type RingStatus = 'low' | 'ok' | 'high';

/**
 * Ціле число відсотків, яке не суперечить кольору кільця:
 * жовтий — не більше 89 %, зелений — 90–110 %, червоний — не менше 111 %.
 * Без цілі (0) відсотка немає — null.
 */
export function ringPercent(value: number, goal: number, status: RingStatus): number | null {
  if (!(goal > 0) || !(value >= 0)) return null;
  const p = Math.round((value / goal) * 100);
  if (status === 'low') return Math.min(p, 89);
  if (status === 'high') return Math.max(p, 111);
  return Math.min(Math.max(p, 90), 110);
}

/** Частка заповнення кільця 0..1 (понад 100 % кільце просто замкнуте) */
export function ringFill(value: number, goal: number): number {
  return goal > 0 ? Math.min(Math.max(value / goal, 0), 1) : 0;
}
