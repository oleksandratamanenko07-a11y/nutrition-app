// Медалі й серії днів ведення щоденника. Дні — рядки РРРР-ММ-ДД (локальна дата користувача).

export interface Medal {
  days: number;
  /** ключ тексту в i18n: medals.<key> */
  key: 'first' | 'three' | 'week' | 'two_weeks' | 'month' | 'hundred';
}

export const MEDALS: Medal[] = [
  { days: 1, key: 'first' },
  { days: 3, key: 'three' },
  { days: 7, key: 'week' },
  { days: 14, key: 'two_weeks' },
  { days: 30, key: 'month' },
  { days: 100, key: 'hundred' },
];

const DAY_MS = 86400000;

function toNum(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export interface Achievements {
  /** Усього унікальних днів із записами (ніколи не зменшується). */
  totalDays: number;
  /** Поточна серія підряд. Жива, якщо запис був сьогодні або вчора. */
  currentStreak: number;
  bestStreak: number;
  earned: Medal[];
  next: Medal | null;
  /** Скільки днів ведення залишилось до наступної медалі. */
  daysToNext: number | null;
}

export function computeAchievements(days: string[], today: string): Achievements {
  const nums = [...new Set(days.map(toNum))].sort((a, b) => a - b);
  const set = new Set(nums);
  const todayN = toNum(today);

  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const n of nums) {
    run = n === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = n;
  }

  // Серія жива, якщо є запис сьогодні; якщо сьогодні ще немає — рахуємо від учора
  let cursor = set.has(todayN) ? todayN : todayN - 1;
  let current = 0;
  while (set.has(cursor)) {
    current += 1;
    cursor -= 1;
  }

  const total = nums.length;
  const earned = MEDALS.filter((m) => total >= m.days);
  const next = MEDALS.find((m) => total < m.days) ?? null;
  return {
    totalDays: total,
    currentStreak: current,
    bestStreak: best,
    earned,
    next,
    daysToNext: next ? next.days - total : null,
  };
}
