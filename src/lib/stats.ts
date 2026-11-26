/**
 * Статистика за тиждень / місяць. Чисті функції без імпортів (перевіряються в scripts/selftest.mjs).
 * Підсумки по днях рахує history.summarizeMonth — тут лише вибірка, середні, порівняння та геометрія графіка.
 * Сьогоднішній (незавершений) день у середні й списки не входить — як і в аналітиці за 3 дні.
 */

export type PeriodKind = 'week' | 'month';
export type Zone = 'low' | 'ok' | 'high';
export type Nutrient = 'kcal' | 'protein' | 'fat' | 'carbs';
export const NUTRIENTS: Nutrient[] = ['kcal', 'protein', 'fat', 'carbs'];

export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
  dates: string[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const addDays = (date: string, n: number): string => {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** Тиждень (пн–нд) або календарний місяць, що містить дату */
export function periodOf(kind: PeriodKind, anchor: string): Period {
  const d = utc(anchor);
  let from: string;
  let to: string;
  if (kind === 'week') {
    from = addDays(anchor, -((d.getUTCDay() + 6) % 7));
    to = addDays(from, 6);
  } else {
    from = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    to = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  }
  const dates: string[] = [];
  for (let x = from; x <= to; x = addDays(x, 1)) dates.push(x);
  return { kind, from, to, dates };
}

export function shiftPeriod(p: Period, n: number): Period {
  if (p.kind === 'week') return periodOf('week', addDays(p.from, 7 * n));
  const d = utc(p.from);
  return periodOf('month', iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))));
}

export interface DayLite {
  date: string;
  count: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  goal: { kcal_goal: number; protein_goal_g: number | null; fat_goal_g: number | null; carbs_goal_g: number | null } | null;
  status: Zone | null;
}

const goalOf = (d: DayLite, n: Nutrient): number | null => {
  if (!d.goal) return null;
  const v = n === 'kcal' ? d.goal.kcal_goal : n === 'protein' ? d.goal.protein_goal_g : n === 'fat' ? d.goal.fat_goal_g : d.goal.carbs_goal_g;
  return v !== null && Number(v) > 0 ? Number(v) : null;
};

export interface PeriodStats {
  /** Завершені дні із записами (сьогодні не враховується) */
  days: number;
  zones: { ok: number; low: number; high: number };
  avg: Record<Nutrient, number> | null;
  /** Середня норма за ці дні (з урахуванням змін цілі) */
  goal: Record<Nutrient, number | null>;
  /** Відсоток від норми, узгоджений із зоною (у low не більше 89, у high не менше 111) */
  pct: Record<Nutrient, number | null>;
  zone: Record<Nutrient, Zone | null>;
}

export function periodStats(
  days: Record<string, DayLite>,
  p: Period,
  today: string,
  zoneOf: (value: number, goal: number) => Zone,
): PeriodStats {
  const done = p.dates.filter((d) => d < today && days[d] && days[d].count > 0).map((d) => days[d]);
  const zones = { ok: 0, low: 0, high: 0 };
  for (const d of done) if (d.status) zones[d.status] += 1;
  const goal: Record<Nutrient, number | null> = { kcal: null, protein: null, fat: null, carbs: null };
  const pct: Record<Nutrient, number | null> = { kcal: null, protein: null, fat: null, carbs: null };
  const zone: Record<Nutrient, Zone | null> = { kcal: null, protein: null, fat: null, carbs: null };
  if (done.length === 0) return { days: 0, zones, avg: null, goal, pct, zone };

  const avg = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const n of NUTRIENTS) {
    avg[n] = done.reduce((s, d) => s + d[n], 0) / done.length;
    const gs = done.map((d) => goalOf(d, n)).filter((v): v is number => v !== null);
    if (gs.length > 0) {
      goal[n] = gs.reduce((s, v) => s + v, 0) / gs.length;
      zone[n] = zoneOf(avg[n], goal[n]!);
      const r = Math.round((avg[n] / goal[n]!) * 100);
      pct[n] = zone[n] === 'low' ? Math.min(r, 89) : zone[n] === 'high' ? Math.max(r, 111) : r;
    }
  }
  return { days: done.length, zones, avg, goal, pct, zone };
}

/** Різниця середніх між періодами; потрібно щонайменше 2 завершені дні в кожному */
export function compare(cur: PeriodStats, prev: PeriodStats): Record<Nutrient, number> | null {
  if (!cur.avg || !prev.avg || cur.days < 2 || prev.days < 2) return null;
  return {
    kcal: cur.avg.kcal - prev.avg.kcal,
    protein: cur.avg.protein - prev.avg.protein,
    fat: cur.avg.fat - prev.avg.fat,
    carbs: cur.avg.carbs - prev.avg.carbs,
  };
}

/** Частка енергії з білків, жирів і вуглеводів (4/9/4 ккал на г), цілі відсотки, що дають рівно 100 */
export function macroShare(avg: { protein: number; fat: number; carbs: number }): { protein: number; fat: number; carbs: number } | null {
  const e = { protein: avg.protein * 4, fat: avg.fat * 9, carbs: avg.carbs * 4 };
  const total = e.protein + e.fat + e.carbs;
  if (!(total > 0)) return null;
  const keys = ['protein', 'fat', 'carbs'] as const;
  const raw = keys.map((k) => (e[k] / total) * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem);
  for (const o of order) {
    if (left <= 0) break;
    floor[o.i] += 1;
    left -= 1;
  }
  return { protein: floor[0], fat: floor[1], carbs: floor[2] };
}

export interface ProductEntry {
  entry_date: string;
  name: string;
  food_id?: string | null;
  amount_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
}

export interface TopProduct {
  name: string;
  /** У скількох різних днях зустрічається */
  days: number;
  grams: number;
  kcal: number;
}

const scaled = (per100: number, grams: number) => (Math.round(per100 * 100) * Math.round(grams * 100)) / 1e6;

/** Найчастіші продукти за період (завершені дні): за кількістю днів, далі за калоріями */
export function topProducts(entries: ProductEntry[], p: Period, today: string, limit = 5): TopProduct[] {
  const map = new Map<string, TopProduct & { set: Set<string> }>();
  for (const e of entries) {
    if (e.entry_date < p.from || e.entry_date > p.to || e.entry_date >= today) continue;
    const key = e.food_id ? `f:${e.food_id}` : `n:${e.name.toLowerCase()}|${e.kcal_100}|${e.protein_100}|${e.fat_100}|${e.carbs_100}`;
    const g = map.get(key) ?? { name: e.name, days: 0, grams: 0, kcal: 0, set: new Set<string>() };
    g.set.add(e.entry_date);
    g.grams += Number(e.amount_g);
    g.kcal += scaled(Number(e.kcal_100), Number(e.amount_g));
    map.set(key, g);
  }
  return [...map.values()]
    .map(({ set, ...rest }) => ({ ...rest, days: set.size }))
    .sort((a, b) => b.days - a.days || b.kcal - a.kcal || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export interface Bar {
  date: string;
  x: number;
  width: number;
  /** null — записів немає, стовпчика немає */
  y: number | null;
  height: number;
  kcal: number | null;
  zone: Zone | null;
  /** Висота (y) риски норми цього дня */
  goalY: number | null;
}

/** Стовпчики калорій по днях періоду; риска норми — для кожного дня своя */
export function barGeometry(
  days: { date: string; kcal: number | null; goal: number | null; zone: Zone | null }[],
  w: number,
  h: number,
  pad: { l: number; r: number; t: number; b: number },
): { bars: Bar[]; max: number } {
  const vals = days.flatMap((d) => [d.kcal ?? 0, d.goal ?? 0]);
  const max = Math.max(1000, Math.ceil((Math.max(...vals, 0) * 1.1) / 500) * 500);
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const slot = iw / Math.max(days.length, 1);
  const width = Math.max(2, slot * 0.7);
  const yOf = (v: number) => pad.t + (1 - v / max) * ih;
  return {
    max,
    bars: days.map((d, i) => {
      const x = pad.l + slot * i + (slot - width) / 2;
      const y = d.kcal !== null ? yOf(d.kcal) : null;
      return {
        date: d.date,
        x,
        width,
        y,
        height: y !== null ? pad.t + ih - y : 0,
        kcal: d.kcal,
        zone: d.zone,
        goalY: d.goal !== null ? yOf(d.goal) : null,
      };
    }),
  };
}
