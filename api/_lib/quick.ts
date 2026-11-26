/**
 * Швидке додавання: «Часто їм» і шаблони прийомів їжі.
 * Файл без імпортів — перевіряється окремо (scripts/selftest.mjs).
 */

/** Те саме, що extras.cleanExtra (файл без імпортів): число 0–100, інакше null */
const ex = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(x) && x >= 0 && x <= 100 ? Math.round(x * 100) / 100 : null;
};

export interface EntryRow {
  food_id?: string | null;
  name: string;
  meal?: string;
  amount_g: number | string;
  kcal_100: number | string;
  protein_100: number | string;
  fat_100: number | string;
  carbs_100: number | string;
  fiber_100?: number | string | null;
  sugar_100?: number | string | null;
  salt_100?: number | string | null;
  entry_date: string;
  created_at?: string | null;
  recipe_snapshot?: unknown;
}

export interface FrequentItem {
  key: string;
  food_id: string | null;
  name: string;
  /** У скількох різних днях продукт був у щоденнику */
  days: number;
  /** Остання використана кількість, г */
  last_amount_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
  fiber_100: number | null;
  sugar_100: number | null;
  salt_100: number | null;
}

const n = (v: number | string): number => Number(v);

/**
 * Продукти, які користувач додає найчастіше (за кількістю різних днів).
 * Страви зі складом (recipe_snapshot) не входять — вони мають власний розділ.
 * Беруться значення й кількість з найсвіжішого запису.
 */
export function aggregateFrequent(rows: EntryRow[], limit = 10, minDays = 2): FrequentItem[] {
  const sorted = rows
    .filter((r) => !(Array.isArray(r.recipe_snapshot) && r.recipe_snapshot.length > 0))
    .sort(
      (a, b) =>
        b.entry_date.localeCompare(a.entry_date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    );

  const groups = new Map<string, { item: FrequentItem; days: Set<string>; firstSeen: number }>();
  sorted.forEach((r, i) => {
    const key = r.food_id
      ? `f:${r.food_id}`
      : `n:${r.name.toLowerCase()}|${n(r.kcal_100)}|${n(r.protein_100)}|${n(r.fat_100)}|${n(r.carbs_100)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        firstSeen: i,
        days: new Set(),
        item: {
          key,
          food_id: r.food_id ?? null,
          name: r.name,
          days: 0,
          last_amount_g: n(r.amount_g),
          kcal_100: n(r.kcal_100),
          protein_100: n(r.protein_100),
          fat_100: n(r.fat_100),
          carbs_100: n(r.carbs_100),
          fiber_100: ex(r.fiber_100),
          sugar_100: ex(r.sugar_100),
          salt_100: ex(r.salt_100),
        },
      };
      groups.set(key, g);
    }
    g.days.add(r.entry_date);
  });

  return [...groups.values()]
    .map((g) => ({ ...g.item, days: g.days.size, firstSeen: g.firstSeen }))
    .filter((g) => g.days >= minDays)
    .sort((a, b) => b.days - a.days || a.firstSeen - b.firstSeen)
    .slice(0, limit)
    .map(({ firstSeen: _f, ...item }) => item);
}

export interface TemplateItem {
  name: string;
  amount_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
  fiber_100: number | null;
  sugar_100: number | null;
  salt_100: number | null;
  food_id: string | null;
  recipe_snapshot: unknown[] | null;
}

export const MAX_TEMPLATE_ITEMS = 30;

/** Записи прийому їжі → склад шаблону (значення на 100 г копіюються, як у щоденнику) */
export function toTemplateItems(rows: EntryRow[]): TemplateItem[] {
  return rows.slice(0, MAX_TEMPLATE_ITEMS).map((r) => ({
    name: r.name,
    amount_g: n(r.amount_g),
    kcal_100: n(r.kcal_100),
    protein_100: n(r.protein_100),
    fat_100: n(r.fat_100),
    carbs_100: n(r.carbs_100),
    fiber_100: ex(r.fiber_100),
    sugar_100: ex(r.sugar_100),
    salt_100: ex(r.salt_100),
    food_id: r.food_id ?? null,
    recipe_snapshot: Array.isArray(r.recipe_snapshot) && r.recipe_snapshot.length > 0 ? r.recipe_snapshot : null,
  }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Перевірка складу шаблону перед додаванням у щоденник; null — дані пошкоджені */
export function cleanTemplateItems(raw: unknown): TemplateItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TEMPLATE_ITEMS) return null;
  const out: TemplateItem[] = [];
  for (const x of raw as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object') return null;
    const name = typeof x.name === 'string' ? x.name.trim() : '';
    if (name.length < 1 || name.length > 120) return null;
    if (
      !inRange(x.amount_g, 0.01, 5000) || !inRange(x.kcal_100, 0, 900) || !inRange(x.protein_100, 0, 100) ||
      !inRange(x.fat_100, 0, 100) || !inRange(x.carbs_100, 0, 100)
    ) {
      return null;
    }
    out.push({
      name,
      amount_g: x.amount_g,
      kcal_100: x.kcal_100,
      protein_100: x.protein_100,
      fat_100: x.fat_100,
      carbs_100: x.carbs_100,
      fiber_100: ex(x.fiber_100),
      sugar_100: ex(x.sugar_100),
      salt_100: ex(x.salt_100),
      food_id: typeof x.food_id === 'string' && UUID_RE.test(x.food_id) ? x.food_id : null,
      recipe_snapshot: Array.isArray(x.recipe_snapshot) && x.recipe_snapshot.length <= 30 ? x.recipe_snapshot : null,
    });
  }
  return out;
}

/** Мітки часу з кроком у 1 мс, щоб скопійовані записи зберегли порядок */
export function orderedTimestamps(count: number, base = Date.now()): string[] {
  return Array.from({ length: count }, (_, i) => new Date(base + i).toISOString());
}
