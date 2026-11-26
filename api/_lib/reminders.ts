/**
 * Розклад нагадувань. Файл без імпортів — перевіряється окремо (scripts/selftest.mjs).
 *
 * Скрипт запускається щогодини, тому «19:00» і «неділя зранку» — це вікна:
 *  - щоденник: з 19:00 до 22:59 за місцевим часом користувача;
 *  - вага: неділя з 09:00 до 12:59.
 * Кожне нагадування надсилається не частіше одного разу за місцеву дату.
 */

export const DIARY_FROM_HOUR = 19;
export const DIARY_TO_HOUR = 22;
export const WEIGHT_FROM_HOUR = 9;
export const WEIGHT_TO_HOUR = 12;
/** Якщо користувач не вів щоденник стільки днів поспіль — нагадування призупиняємо, щоб не набридати */
export const DORMANT_DAYS = 14;
/** Якщо вагу вже вносили за останні N днів — недільне нагадування не потрібне */
export const WEIGHT_RECENT_DAYS = 2;
/** Аналітика харчування: щодня з 09:00 до 12:59 перевіряємо, чи пройшло 3 дні від попередньої */
export const REVIEW_FROM_HOUR = 9;
export const REVIEW_TO_HOUR = 12;
export const REVIEW_CYCLE = 3;

export const MESSAGES = {
  diary:
    '🍽 Ви ще нічого не записали в щоденник сьогодні. Додайте їжу, поки день не закінчився — це займе хвилину.',
  weight:
    '⚖️ Сьогодні неділя — час оновити вагу. Це 10 секунд, а графік прогресу стане точнішим.',
} as const;

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length < 3 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  /** РРРР-ММ-ДД за місцевим часом */
  date: string;
  hour: number;
  /** 0 — неділя */
  weekday: number;
}

export function localParts(now: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

/** РРРР-ММ-ДД ± n днів (без часових поясів) */
export function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface DueInput {
  now: Date;
  tz: string | null;
  diaryOn: boolean;
  weightOn: boolean;
  lastDiary: string | null;
  lastWeight: string | null;
  reviewOn?: boolean;
  /** Дата останньої надісланої аналітики */
  lastReview?: string | null;
  /** Дата, коли востаннє перевіряли, чи є що аналізувати (щоб не робити запити щогодини) */
  lastReviewCheck?: string | null;
}

export interface Due {
  date: string;
  diary: boolean;
  weight: boolean;
  review: boolean;
}

/** Етап 1 — лише за часом і налаштуваннями (без запитів до бази). null — нічого не потрібно. */
export function dueByTime(i: DueInput): Due | null {
  if (!i.tz || !validTz(i.tz)) return null;
  const p = localParts(i.now, i.tz);
  const diary =
    i.diaryOn && p.hour >= DIARY_FROM_HOUR && p.hour <= DIARY_TO_HOUR && i.lastDiary !== p.date;
  const weight =
    i.weightOn &&
    p.weekday === 0 &&
    p.hour >= WEIGHT_FROM_HOUR &&
    p.hour <= WEIGHT_TO_HOUR &&
    i.lastWeight !== p.date;
  const review =
    !!i.reviewOn &&
    p.hour >= REVIEW_FROM_HOUR &&
    p.hour <= REVIEW_TO_HOUR &&
    (i.lastReviewCheck ?? null) !== p.date &&
    (!i.lastReview || p.date >= addDaysStr(i.lastReview, REVIEW_CYCLE));
  return diary || weight || review ? { date: p.date, diary, weight, review } : null;
}

export interface Facts {
  /** Є хоча б один запис у щоденнику за сьогодні */
  hasEntryToday: boolean;
  /** Користувач вів щоденник за останні DORMANT_DAYS днів */
  activeRecently: boolean;
  /** Вагу вносили за останні WEIGHT_RECENT_DAYS днів */
  weightRecent: boolean;
}

/** Етап 2 — підтвердження за даними користувача */
export function confirmReminders(due: Due, f: Facts): ('diary' | 'weight')[] {
  const out: ('diary' | 'weight')[] = [];
  if (due.diary && !f.hasEntryToday && f.activeRecently) out.push('diary');
  if (due.weight && !f.weightRecent) out.push('weight');
  return out;
}
