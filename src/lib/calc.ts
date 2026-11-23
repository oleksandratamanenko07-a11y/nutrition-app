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
  activity: Activity;
  goal: Goal;
}

/**
 * Орієнтовна добова норма. Це оцінка, а не медична рекомендація.
 * Схуднення: −15 %, набір: +10 %. Нижня межа: 1200 (ж) / 1500 (ч) ккал.
 * Білок: 2.0 / 1.6 / 1.8 г на кг ваги (схуднення / підтримка / набір).
 * Жири: 28 % калорій. Вуглеводи: решта калорій.
 */
export function computeGoals(p: GoalInput): Goals {
  const tdee = bmr(p.sex, p.weightKg, p.heightCm, p.age) * ACTIVITY_FACTOR[p.activity];
  const adjust = p.goal === 'lose' ? 0.85 : p.goal === 'gain' ? 1.1 : 1;
  const floor = p.sex === 'male' ? 1500 : 1200;
  const kcal = Math.max(floor, Math.round(tdee * adjust));
  const proteinPerKg = p.goal === 'lose' ? 2.0 : p.goal === 'gain' ? 1.8 : 1.6;
  const protein = Math.round(p.weightKg * proteinPerKg);
  const fat = Math.round((kcal * 0.28) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carbs };
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
