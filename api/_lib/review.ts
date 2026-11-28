/**
 * Аналітика харчування за 3 повні дні (без сьогоднішнього).
 * Файл без імпортів — перевіряється окремо (scripts/selftest.mjs).
 * Формули збігаються з calc.ts: порції рахуються в цілих сотих, межі зон — 90 % і 110 % (як на головній).
 */

export const REVIEW_DAYS = 3;
/** Нове повідомлення не раніше ніж через стільки днів після попереднього */
export const REVIEW_CYCLE_DAYS = 3;
/** Мінімум днів із записами, щоб аналізувати */
export const MIN_LOGGED_DAYS = 2;

export interface ReviewEntry {
  entry_date: string;
  amount_g: number | string;
  kcal_100: number | string;
  protein_100: number | string;
  fat_100: number | string;
  carbs_100: number | string;
}

export interface ReviewGoal {
  effective_from: string;
  kcal_goal: number | string;
  protein_goal_g: number | string | null;
  fat_goal_g: number | string | null;
  carbs_goal_g: number | string | null;
}

export type Status = 'low' | 'ok' | 'high';
export type Nutrient = 'kcal' | 'protein' | 'fat' | 'carbs';
const NUTRIENTS: Nutrient[] = ['kcal', 'protein', 'fat', 'carbs'];

const scaled = (per100: number, grams: number) => (Math.round(per100 * 100) * Math.round(grams * 100)) / 1e6;

/** Той самий поділ на зони, що й calc.goalStatus: <90 % — low, 90–110 % включно — ok, >110 % — high */
export function zone(value: number, goal: number): Status {
  if (!(goal > 0)) return 'low';
  const pct100 = (value * 10000) / goal;
  if (pct100 < 9000 - 1e-9) return 'low';
  if (pct100 > 11000 + 1e-9) return 'high';
  return 'ok';
}

/** Відсоток для показу узгоджений із зоною: у «low» ніколи не більше 89, у «high» — не менше 111 */
export function shownPct(value: number, goal: number, st: Status): number {
  const r = Math.round((value / goal) * 100);
  if (st === 'low') return Math.min(r, 89);
  if (st === 'high') return Math.max(r, 111);
  return r;
}

const shiftDate = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Три повні дні перед сьогоднішньою датою (від давнішого до новішого) */
export function reviewWindow(today: string): string[] {
  return Array.from({ length: REVIEW_DAYS }, (_, i) => shiftDate(today, i - REVIEW_DAYS));
}

/** Ціль, що діяла на дату (як history.goalForDate): остання зміна не пізніше цієї дати, інакше найраніша */
export function goalOn(goals: ReviewGoal[], date: string): ReviewGoal | null {
  if (goals.length === 0) return null;
  const sorted = [...goals].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  let chosen = sorted[0];
  for (const g of sorted) if (g.effective_from <= date) chosen = g;
  return chosen;
}

const goalValue = (g: ReviewGoal, n: Nutrient): number | null => {
  const raw = n === 'kcal' ? g.kcal_goal : n === 'protein' ? g.protein_goal_g : n === 'fat' ? g.fat_goal_g : g.carbs_goal_g;
  if (raw === null || raw === undefined) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
};

export interface Review {
  /** Скільки днів із записами (2 або 3) */
  days: number;
  avg: Record<Nutrient, number>;
  /** Середня норма за ці дні (враховує зміни цілі); null — норми немає */
  goal: Record<Nutrient, number | null>;
  status: Record<Nutrient, Status | null>;
}

export function analyze(entries: ReviewEntry[], goals: ReviewGoal[], window: string[]): Review | null {
  const totals = new Map<string, Record<Nutrient, number>>();
  for (const e of entries) {
    if (!window.includes(e.entry_date)) continue;
    const g = Number(e.amount_g);
    const t = totals.get(e.entry_date) ?? { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    t.kcal += scaled(Number(e.kcal_100), g);
    t.protein += scaled(Number(e.protein_100), g);
    t.fat += scaled(Number(e.fat_100), g);
    t.carbs += scaled(Number(e.carbs_100), g);
    totals.set(e.entry_date, t);
  }
  const logged = window.filter((d) => totals.has(d));
  if (logged.length < MIN_LOGGED_DAYS) return null;

  const avg = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const goal: Record<Nutrient, number | null> = { kcal: null, protein: null, fat: null, carbs: null };
  const status: Record<Nutrient, Status | null> = { kcal: null, protein: null, fat: null, carbs: null };
  for (const n of NUTRIENTS) {
    avg[n] = logged.reduce((s, d) => s + totals.get(d)![n], 0) / logged.length;
    const gs = logged
      .map((d) => {
        const g = goalOn(goals, d);
        return g ? goalValue(g, n) : null;
      })
      .filter((v): v is number => v !== null);
    if (gs.length > 0) {
      goal[n] = gs.reduce((s, v) => s + v, 0) / gs.length;
      status[n] = zone(avg[n], goal[n]!);
    }
  }
  // без норми калорій порівнювати нема з чим
  if (goal.kcal === null) return null;
  return { days: logged.length, avg, goal, status };
}

const int = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Що саме вважаємо зауваженням: калорії — в обидва боки, білки — лише недобір, жири й вуглеводи — лише перебір */
export function issues(r: Review): { nutrient: Nutrient; status: Status }[] {
  const out: { nutrient: Nutrient; status: Status }[] = [];
  const s = r.status;
  if (s.kcal === 'low' || s.kcal === 'high') out.push({ nutrient: 'kcal', status: s.kcal });
  if (s.protein === 'low') out.push({ nutrient: 'protein', status: 'low' });
  if (s.fat === 'high') out.push({ nutrient: 'fat', status: 'high' });
  if (s.carbs === 'high') out.push({ nutrient: 'carbs', status: 'high' });
  return out;
}

const NAME: Record<Nutrient, string> = { kcal: 'Калорії', protein: 'Білки', fat: 'Жири', carbs: 'Вуглеводи' };

export function reviewMessage(r: Review, tips: string[] = []): string {
  const base = reviewBody(r);
  return tips.length === 0 ? base : `${base}\n\n💡 Що можна зробити:\n${tips.map((x) => `• ${x}`).join('\n')}`;
}

function reviewBody(r: Review): string {
  const head = r.days < REVIEW_DAYS ? `📊 Харчування за ${REVIEW_DAYS} дні (записи за ${r.days} з них)` : `📊 Харчування за ${REVIEW_DAYS} дні`;
  const kcal = `${int(r.avg.kcal)} із ${int(r.goal.kcal!)} ккал`;
  const found = issues(r);

  if (found.length === 0) {
    return `${head}: усе в нормі. Калорії в середньому ${kcal}, ` +
      `${r.status.protein === 'low' ? '' : 'білків достатньо, '}жири й вуглеводи не перевищують норму. Так тримати!`;
  }

  const lines = found.map(({ nutrient, status }) => {
    const goal = r.goal[nutrient]!;
    const unit = nutrient === 'kcal' ? 'ккал' : 'г';
    const pct = shownPct(r.avg[nutrient], goal, status);
    const verdict =
      nutrient === 'kcal' ? (status === 'low' ? 'менше за норму' : 'більше за норму') : status === 'low' ? 'замало' : 'забагато';
    const have = nutrient === 'kcal' ? int(r.avg[nutrient]) : `${int(r.avg[nutrient])} г`;
    return `• ${NAME[nutrient]}: у середньому ${have} із ${int(goal)} ${unit} (${pct}%) — ${verdict}.`;
  });
  const tail = r.status.kcal === 'ok' ? `\nКалорії в нормі: ${kcal}.` : '';
  return `${head}\n${lines.join('\n')}${tail}`;
}
