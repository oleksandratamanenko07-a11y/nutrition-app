export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'high' | 'very_high';
export type Goal = 'lose' | 'maintain' | 'gain';

export interface Goals {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface Per100 {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
};

/** Базовий обмін речовин за формулою Міффліна — Сан Жеора. */
export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

export interface GoalInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  /** Бажана вага. Різниця менше за 0,5 кг вважається точністю цілі. */
  targetKg?: number;
  activity: Activity;
  goal: Goal;
}

export interface Plan extends Goals {
  /** Скільки кг на тиждень змінюється вага за цією нормою (мінус — схуднення). */
  weeklyKg: number;
  /** Орієнтовно тижнів до цілі, або null, якщо цілі немає. */
  weeks: number | null;
  /** Мета не збігається з бажаною вагою — норма розрахована як підтримання. */
  conflict: boolean;
}

export const KCAL_PER_KG = 7700;
export const PRECISION_KG = 0.5;
const LOSE_KG_PER_WEEK = 0.5;
const GAIN_KG_PER_WEEK = 0.25;

/**
 * Орієнтовна добова норма. Це оцінка, а не медична рекомендація.
 * Підтримання: BMR × коефіцієнт активності.
 * Схуднення: −0,5 кг/тиж. (≈ −550 ккал/добу), не більше −25 % від підтримання.
 * Набір: +0,25 кг/тиж. (≈ +275 ккал/добу).
 * Якщо до цілі менше 0,5 кг або мета суперечить бажаній вазі — підтримання.
 * Нижня межа: 1200 (ж) / 1500 (ч) ккал.
 * Білок: 1,8 г/кг (схуднення — від бажаної ваги), 1,6 (підтримка), 1,8 (набір).
 * Жири: 28 % калорій. Вуглеводи: решта.
 */
export function computeGoals(p: GoalInput): Plan {
  const tdee = bmr(p.sex, p.weightKg, p.heightCm, p.age) * ACTIVITY_FACTOR[p.activity];
  const target = p.targetKg ?? p.weightKg;
  const diff = target - p.weightKg; // < 0 — треба схуднути
  const gap = Math.abs(diff);

  let direction: Goal = p.goal;
  let conflict = false;
  if (p.goal === 'lose' && diff > -PRECISION_KG) direction = 'maintain';
  if (p.goal === 'gain' && diff < PRECISION_KG) direction = 'maintain';
  if (p.targetKg !== undefined && direction === 'maintain' && p.goal !== 'maintain') conflict = true;
  // Мета «підтримання», а бажана вага відрізняється — це теж розбіжність
  if (p.goal === 'maintain' && gap >= PRECISION_KG && p.targetKg !== undefined) conflict = true;

  const floor = p.sex === 'male' ? 1500 : 1200;
  let kcal = tdee;
  if (direction === 'lose') {
    const dailyDeficit = (LOSE_KG_PER_WEEK * KCAL_PER_KG) / 7;
    kcal = Math.max(tdee * 0.75, tdee - dailyDeficit);
  } else if (direction === 'gain') {
    kcal = tdee + (GAIN_KG_PER_WEEK * KCAL_PER_KG) / 7;
  }
  kcal = Math.max(floor, Math.round(kcal));

  const weeklyKg = ((kcal - tdee) * 7) / KCAL_PER_KG;
  const moving =
    (direction === 'lose' && weeklyKg < -0.01) || (direction === 'gain' && weeklyKg > 0.01);
  const weeks = moving ? Math.max(1, Math.round(gap / Math.abs(weeklyKg))) : null;

  const refWeight = direction === 'lose' ? Math.min(p.weightKg, target) : p.weightKg;
  const proteinPerKg = direction === 'maintain' ? 1.6 : 1.8;
  const protein = Math.round(refWeight * proteinPerKg);
  const fat = Math.round((kcal * 0.28) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carbs, weeklyKg, weeks, conflict };
}

/**
 * Точне множення «значення на 100 г × грами / 100».
 * Обчислення йде в цілих сотих, щоб уникнути похибок float.
 */
function scaled(per100: number, grams: number): number {
  return (Math.round(per100 * 100) * Math.round(grams * 100)) / 1e6;
}

/** Нутрієнти порції (без округлення). */
export function portion(per100: Per100, grams: number): Per100 {
  return {
    kcal: scaled(per100.kcal, grams),
    protein: scaled(per100.protein, grams),
    fat: scaled(per100.fat, grams),
    carbs: scaled(per100.carbs, grams),
  };
}

/** Сума без проміжного округлення. */
export function sum(items: Per100[]): Per100 {
  return items.reduce(
    (a, x) => ({
      kcal: a.kcal + x.kcal,
      protein: a.protein + x.protein,
      fat: a.fat + x.fat,
      carbs: a.carbs + x.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

/** Округлення до 1 знака тільки для показу. */
export function round1(x: number): number {
  return Math.round((x + Number.EPSILON) * 10) / 10;
}
