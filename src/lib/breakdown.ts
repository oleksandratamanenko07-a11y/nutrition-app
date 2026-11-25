import type { Entry } from './api';

export type Macro = 'protein' | 'fat' | 'carbs';

export interface BreakdownRow {
  id: string;
  name: string;
  meal: Entry['meal'];
  amount_g: number;
  /** Скільки грамів макронутрієнта дав цей запис (без округлення) */
  value: number;
  /** Збережена страва: показується однією позицією, без розкладання на інгредієнти */
  isDish: boolean;
}

// Та сама формула, що й у calc.portion: «значення на 100 г × грами / 100» у цілих сотих.
const scaled = (per100: number, grams: number) =>
  (Math.round(per100 * 100) * Math.round(grams * 100)) / 1e6;

const FIELD = { protein: 'protein_100', fat: 'fat_100', carbs: 'carbs_100' } as const;

/**
 * Внесок кожного запису щоденника в обраний макронутрієнт.
 * Значення беруться з тих самих записів, що й підсумок на головній.
 * total складається в порядку записів — так само, як day.totals(), тож збігається з головною до останнього знака.
 */
export function macroBreakdown(entries: Entry[], macro: Macro): { rows: BreakdownRow[]; total: number } {
  const rows: BreakdownRow[] = entries.map((e) => ({
    id: e.id,
    name: e.name,
    meal: e.meal,
    amount_g: e.amount_g,
    value: scaled(e[FIELD[macro]], e.amount_g),
    isDish: !!e.recipe_snapshot && e.recipe_snapshot.length > 0,
  }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return { rows: [...rows].sort((a, b) => b.value - a.value), total };
}
