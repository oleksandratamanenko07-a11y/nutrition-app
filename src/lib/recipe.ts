// Власні невеликі функції замість імпорту з calc, щоб файл можна було перевіряти окремо.
/** «значення на 100 г × грами / 100» у цілих сотих — без похибок float. */
const scaled = (per100: number, grams: number) => (Math.round(per100 * 100) * Math.round(grams * 100)) / 1e6;
const round1 = (x: number) => Math.round((x + Number.EPSILON) * 10) / 10;

export type Nutrient = 'kcal' | 'protein' | 'fat' | 'carbs';
export const NUTRIENTS: Nutrient[] = ['kcal', 'protein', 'fat', 'carbs'];

export interface Ingredient {
  food_id: string | null;
  name: string;
  amount_g: number;
  /** на 100 г; null — «не вказано», нуль не підставляється */
  kcal_100: number | null;
  protein_100: number | null;
  fat_100: number | null;
  carbs_100: number | null;
}

export interface DishTotals {
  /** Вага страви: введена вручну (вага готової страви) або сума інгредієнтів. */
  weight: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Показники, для яких у деяких інгредієнтів немає даних — підсумок за ними неповний. */
  missing: Nutrient[];
}

const key = (n: Nutrient) => `${n === 'kcal' ? 'kcal' : n}_100` as
  'kcal_100' | 'protein_100' | 'fat_100' | 'carbs_100';

/** Харчова цінність всієї страви. Відсутні значення НЕ рахуються нулем мовчки — вони потрапляють у missing. */
export function dishTotals(ings: Ingredient[], overrideWeight: number | null = null): DishTotals {
  const sumWeight = ings.reduce((s, i) => s + Math.round(i.amount_g * 100), 0) / 100;
  const out: DishTotals = {
    weight: overrideWeight && overrideWeight > 0 ? overrideWeight : sumWeight,
    kcal: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    missing: [],
  };
  for (const n of NUTRIENTS) {
    let total = 0;
    let missing = false;
    for (const i of ings) {
      const v = i[key(n)];
      if (v === null) {
        missing = true;
        continue;
      }
      total += scaled(v, i.amount_g);
    }
    out[n] = total;
    if (missing) out.missing.push(n);
  }
  return out;
}

/** Значення на 100 г страви (для запису в щоденник). Повертає null, якщо дані неповні або вага нульова. */
export function dishPer100(tot: DishTotals): { kcal: number; protein: number; fat: number; carbs: number } | null {
  if (tot.missing.length > 0 || !(tot.weight > 0)) return null;
  const r2 = (x: number) => Math.round(((x * 100) / tot.weight) * 100) / 100;
  return { kcal: r2(tot.kcal), protein: r2(tot.protein), fat: r2(tot.fat), carbs: r2(tot.carbs) };
}

/** Перевірка фізичної правдоподібності ваги готової страви: БЖВ не можуть важити більше за страву. */
export function weightIsPlausible(tot: DishTotals): boolean {
  return tot.protein + tot.fat + tot.carbs <= tot.weight + 0.01;
}

export function fmt1(x: number): string {
  return round1(x).toLocaleString('uk-UA', { maximumFractionDigits: 1 });
}
