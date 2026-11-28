// Чиста логіка екрана «Спільні покупки» (без імпортів, щоб її можна було перевірити самотестом).

export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'pcs';
export const UNITS: Unit[] = ['g', 'kg', 'ml', 'l', 'pcs'];
export const UNIT_LABEL: Record<Unit, string> = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };

export interface ShopItem {
  id: string;
  name: string;
  qty: number | null;
  unit: Unit | null;
  comment: string | null;
  added_by: number | null;
  bought: boolean;
  bought_by: number | null;
  bought_at: string | null;
  cleared_at: string | null;
  version: number;
  created_at: string;
}

/** «1,5 кг», «3 шт»; без кількості — порожній рядок. */
export function formatQty(qty: number | null, unit: Unit | null): string {
  if (qty === null) return '';
  const n = String(Math.round(qty * 1000) / 1000).replace('.', ',');
  return unit ? `${n} ${UNIT_LABEL[unit]}` : n;
}

/** Спочатку не куплені (старіші вище), потім куплені (щойно куплені вище). */
export function sortItems<T extends Pick<ShopItem, 'bought' | 'bought_at' | 'created_at'>>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.bought !== b.bought) return a.bought ? 1 : -1;
    if (a.bought) return (b.bought_at ?? '').localeCompare(a.bought_at ?? '');
    return a.created_at.localeCompare(b.created_at);
  });
}

export function progress(items: Pick<ShopItem, 'bought'>[]): { bought: number; total: number; pct: number } {
  const total = items.length;
  const bought = items.filter((i) => i.bought).length;
  return { bought, total, pct: total === 0 ? 0 : Math.round((bought / total) * 100) };
}

/** Скільки лишилось діяти запрошенню: «23 год 10 хв», «5 хв», або null, якщо вже минуло. */
export function timeLeft(expiresAt: string, now = Date.now()): string | null {
  const ms = new Date(expiresAt).getTime() - now;
  if (!(ms > 0)) return null;
  const mins = Math.ceil(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} год ${m} хв` : `${m} хв`;
}

/** Групує історію за днем очищення (новіші вище). */
export function groupHistory<T extends { cleared_at: string | null }>(items: T[]): { day: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const i of items) {
    if (!i.cleared_at) continue;
    const day = i.cleared_at.slice(0, 10);
    map.set(day, [...(map.get(day) ?? []), i]);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, its]) => ({ day, items: its }));
}
