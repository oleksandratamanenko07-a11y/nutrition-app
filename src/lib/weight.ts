/** Вага: статистика та геометрія графіка. Без імпортів — перевіряється окремо (scripts/selftest.mjs). */

export interface WeightLog {
  log_date: string;
  weight_kg: number;
}

export interface WeightStats {
  start: number | null;
  current: number | null;
  /** current − start */
  change: number | null;
  /** Скільки лишилось до цілі: target − current (мінус — треба схуднути) */
  remaining: number | null;
  /** Прогрес до цілі, 0–100; null, якщо стартова вага вже біля цілі (режим підтримки) */
  progressPct: number | null;
  reached: boolean;
  /** кг за тиждень за останні 28 днів; null — замало даних */
  weeklyPace: number | null;
}

const DAY = 86400000;
const dayNum = (d: string): number => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd) / DAY;
};

export const sortLogs = (logs: WeightLog[]): WeightLog[] =>
  [...logs].sort((a, b) => a.log_date.localeCompare(b.log_date));

export function weightStats(logsIn: WeightLog[], target: number | null): WeightStats {
  const logs = sortLogs(logsIn);
  if (logs.length === 0) {
    return { start: null, current: null, change: null, remaining: null, progressPct: null, reached: false, weeklyPace: null };
  }
  const start = logs[0].weight_kg;
  const last = logs[logs.length - 1];
  const current = last.weight_kg;

  let remaining: number | null = null;
  let progressPct: number | null = null;
  let reached = false;
  if (target !== null) {
    remaining = target - current;
    if (Math.abs(target - start) < 0.5) {
      reached = Math.abs(target - current) < 0.5;
    } else {
      const losing = target < start;
      reached = losing ? current <= target : current >= target;
      const raw = (start - current) / (start - target);
      progressPct = Math.round(Math.min(1, Math.max(0, raw)) * 100);
    }
  }

  const from = dayNum(last.log_date) - 28;
  const window = logs.filter((l) => dayNum(l.log_date) >= from);
  let weeklyPace: number | null = null;
  if (window.length >= 2) {
    const a = window[0];
    const span = dayNum(last.log_date) - dayNum(a.log_date);
    if (span >= 7) weeklyPace = ((current - a.weight_kg) / span) * 7;
  }

  return { start, current, change: current - start, remaining, progressPct, reached, weeklyPace };
}

/** Чи варто перерахувати норму: вага змінилась щонайменше на 2 кг відносно ваги, за якою рахували норму */
export function needsRecalc(current: number | null, goalWeight: number | null, threshold = 2): boolean {
  if (current === null || goalWeight === null) return false;
  return Math.abs(current - goalWeight) >= threshold;
}

/** Залишає записи за останні `days` днів (від останнього запису); null — усі */
export function lastDays(logsIn: WeightLog[], days: number | null): WeightLog[] {
  const logs = sortLogs(logsIn);
  if (days === null || logs.length === 0) return logs;
  const from = dayNum(logs[logs.length - 1].log_date) - days;
  return logs.filter((l) => dayNum(l.log_date) >= from);
}

export interface ChartPoint {
  x: number;
  y: number;
  log: WeightLog;
}

export interface Chart {
  points: ChartPoint[];
  targetY: number | null;
  min: number;
  max: number;
}

/** Координати для SVG: x — за датою, y — за вагою (з запасом), лінія цілі — якщо вона в межах графіка */
export function chartGeometry(
  logsIn: WeightLog[],
  target: number | null,
  w: number,
  h: number,
  pad: { l: number; r: number; t: number; b: number },
): Chart | null {
  const logs = sortLogs(logsIn);
  if (logs.length === 0) return null;
  const ws = logs.map((l) => l.weight_kg);
  let min = Math.min(...ws);
  let max = Math.max(...ws);
  if (target !== null) {
    min = Math.min(min, target);
    max = Math.max(max, target);
  }
  const margin = Math.max((max - min) * 0.1, 0.5);
  min -= margin;
  max += margin;

  const d0 = dayNum(logs[0].log_date);
  const d1 = dayNum(logs[logs.length - 1].log_date);
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const xOf = (d: number) => (d1 === d0 ? pad.l + iw / 2 : pad.l + ((d - d0) / (d1 - d0)) * iw);
  const yOf = (v: number) => pad.t + (1 - (v - min) / (max - min)) * ih;

  return {
    points: logs.map((log) => ({ x: xOf(dayNum(log.log_date)), y: yOf(log.weight_kg), log })),
    targetY: target !== null ? yOf(target) : null,
    min,
    max,
  };
}
