import type { db } from './supabase.js';

/** Кількість копій рахуємо заново (а не +1), тому вона не розходиться при збоях і повторах */
export async function refreshCopies(supabase: ReturnType<typeof db>, sourceId: string): Promise<void> {
  const { count } = await supabase
    .from('recipes').select('id', { count: 'exact', head: true }).eq('source_id', sourceId);
  await supabase.from('recipes').update({ copies_count: count ?? 0 }).eq('id', sourceId);
}

export const CATEGORIES = ['breakfast', 'soup', 'main', 'drink', 'bakery', 'snack', 'dessert'] as const;

/** Невідома (стара) категорія стає null — страва показується як «Без категорії» */
export function normCategory(v: unknown): (typeof CATEGORIES)[number] | null {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v) ? (v as (typeof CATEGORIES)[number]) : null;
}
