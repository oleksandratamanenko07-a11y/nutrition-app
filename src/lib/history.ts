import type { Entry } from './api';

export interface GoalRow {
  effective_from: string;
  kcal_goal: number;
  protein_goal_g: number | null;
  fat_goal_g: number | null;
  carbs_goal_g: number | null;
}

export type DayStatus = 'low' | 'ok' | 'high';

export interface DaySummary {
  date: string;
  count: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  goal: GoalRow | null;
  /** null — немає цілі для порівняння */
  status: DayStatus | null;
}

export interface MonthStats {
  logged: number;
  ok: number;
  low: number;
  high: number;
}

// Та сама формула, що й calc.portion: «значення на 100 г × грами / 100» у цілих сотих.
const scaled = (per100: number, grams: number) =>
  (Math.round(per100 * 100) * Math.round(grams * 100)) / 1e6;

/** Ціль, що діяла на дату: остання зміна не пізніше цієї дати; для днів до першого запису історії — найраніша. */
export function goalForDate(goals: GoalRow[], date: string): GoalRow | null {
  if (goals.length === 0) return null;
  const sorted = [...goals].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  let chosen = sorted[0];
  for (const g of sorted) {
    if (g.effective_from <= date) chosen = g;
  }
  return chosen;
}

/** Скільки порожніх клітинок перед 1-м числом (тиждень з понеділка) і скільки днів у місяці. month: 0–11. */
export function monthGrid(year: number, month: number): { lead: number; days: number } {
  const first = new Date(year, month, 1);
  return { lead: (first.getDay() + 6) % 7, days: new Date(year, month + 1, 0).getDate() };
}

export const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/**
 * Підсумки по днях місяця і статистика.
 * status — та сама функція, що й на головній (calc.goalStatus), передається ззовні.
 * Дні без записів не потрапляють ні в «добре», ні в «нижче», ні в «вище».
 */
export function summarizeMonth(
  entries: Entry[],
  goals: GoalRow[],
  status: (value: number, goal: number) => DayStatus,
): { days: Record<string, DaySummary>; stats: MonthStats } {
  const days: Record<string, DaySummary> = {};
  for (const e of entries) {
    const d =
      days[e.entry_date] ??
      (days[e.entry_date] = {
        date: e.entry_date,
        count: 0,
        kcal: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        goal: goalForDate(goals, e.entry_date),
        status: null,
      });
    d.count += 1;
    d.kcal += scaled(e.kcal_100, e.amount_g);
    d.protein += scaled(e.protein_100, e.amount_g);
    d.fat += scaled(e.fat_100, e.amount_g);
    d.carbs += scaled(e.carbs_100, e.amount_g);
  }
  const stats: MonthStats = { logged: 0, ok: 0, low: 0, high: 0 };
  for (const d of Object.values(days)) {
    stats.logged += 1;
    if (d.goal && d.goal.kcal_goal > 0) {
      d.status = status(d.kcal, d.goal.kcal_goal);
      stats[d.status] += 1;
    }
  }
  return { days, stats };
}
