import { initData } from './telegram';
import type { Activity, Goal, Sex } from './calc';
import type { Ingredient } from './recipe';
import type { GoalRow } from './history';
import type { WeightLog } from './weight';

export interface Profile {
  telegram_id: number;
  first_name: string | null;
  sex: Sex | null;
  birth_year: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  target_weight_kg: number | null;
  activity_level: Activity | null;
  goal: Goal | null;
  kcal_goal: number | null;
  protein_goal_g: number | null;
  fat_goal_g: number | null;
  carbs_goal_g: number | null;
  water_goal_ml: number | null;
  onboarded: boolean;
  /** Вага, за якою востаннє рахували норму */
  goal_weight_kg?: number | null;
  tz?: string | null;
  remind_diary?: boolean;
  remind_weight?: boolean;
  remind_review?: boolean;
}

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface SnapshotItem {
  name: string;
  amount_g: number;
  kcal_100: number | null;
  protein_100: number | null;
  fat_100: number | null;
  carbs_100: number | null;
  fiber_100?: number | null;
  sugar_100?: number | null;
  salt_100?: number | null;
}

export interface Entry {
  food_id?: string | null;
  recipe_snapshot?: SnapshotItem[] | null;
  id: string;
  entry_date: string;
  meal: Meal;
  name: string;
  amount_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
  fiber_100?: number | null;
  sugar_100?: number | null;
  salt_100?: number | null;
}

export interface Day {
  entries: Entry[];
  water_ml: number;
}

export type ApiErrorKind = 'offline' | 'unauthorized' | 'invalid' | 'limit' | 'server';

export class ApiError extends Error {
  kind: ApiErrorKind;
  /** Код помилки з відповіді сервера (наприклад, invite_expired або conflict), якщо він був */
  code: string | null;
  constructor(kind: ApiErrorKind, code: string | null = null) {
    super(kind);
    this.kind = kind;
    this.code = code;
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `tma ${initData()}`,
      },
    });
  } catch {
    throw new ApiError('offline');
  }
  if (!res.ok) {
    let code: string | null = null;
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === 'string') code = j.error;
    } catch {
      /* тіло не JSON */
    }
    if (res.status === 401) throw new ApiError('unauthorized', code);
    if (res.status === 400) throw new ApiError('invalid', code);
    if (res.status === 409) throw new ApiError('limit', code);
    throw new ApiError('server', code);
  }
  return (await res.json()) as T;
}

// ---------- Профіль ----------

export async function getProfile(): Promise<Profile> {
  const r = await request<{ profile: Profile }>('/api/profile');
  return r.profile;
}

export interface ProfileInput {
  sex: Sex;
  age: number;
  height_cm: number;
  weight_kg: number;
  target_weight_kg: number;
  activity_level: Activity;
  goal: Goal;
  kcal_goal: number;
  protein_goal_g: number;
  fat_goal_g: number;
  carbs_goal_g: number;
  water_goal_ml: number;
  today: string;
}

export async function saveProfile(input: ProfileInput): Promise<Profile> {
  const r = await request<{ profile: Profile }>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return r.profile;
}

// ---------- Щоденник ----------

function normEntry(e: Entry): Entry {
  return {
    ...e,
    amount_g: Number(e.amount_g),
    kcal_100: Number(e.kcal_100),
    protein_100: Number(e.protein_100),
    fat_100: Number(e.fat_100),
    carbs_100: Number(e.carbs_100),
    fiber_100: e.fiber_100 == null ? null : Number(e.fiber_100),
    sugar_100: e.sugar_100 == null ? null : Number(e.sugar_100),
    salt_100: e.salt_100 == null ? null : Number(e.salt_100),
  };
}

export async function getDay(date: string): Promise<Day> {
  const r = await request<{ entries: Entry[]; water_ml: number }>(
    `/api/diary?date=${encodeURIComponent(date)}`,
  );
  return { entries: r.entries.map(normEntry), water_ml: Number(r.water_ml) };
}

export interface NewEntry {
  barcode?: string | null;
  brand?: string | null;
  country?: string | null;
  image_url?: string | null;
  source?: 'manual' | 'openfoodfacts' | 'usda' | 'recipe';
  recipe_snapshot?: SnapshotItem[] | null;
  date: string;
  meal: Meal;
  name: string;
  amount_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
  fiber_100?: number | null;
  sugar_100?: number | null;
  salt_100?: number | null;
  /** Порція продукту: передайте, щоб зберегти (null — прибрати); не передавайте, щоб не змінювати */
  portion_g?: number | null;
  portion_name?: string | null;
}

export async function addEntry(input: NewEntry): Promise<Entry> {
  const r = await request<{ entry: Entry }>('/api/diary', {
    method: 'POST',
    body: JSON.stringify({ type: 'entry', ...input }),
  });
  return normEntry(r.entry);
}

export async function updateEntry(
  id: string,
  patch: { amount_g?: number; meal?: Meal },
): Promise<Entry> {
  const r = await request<{ entry: Entry }>('/api/diary', {
    method: 'PATCH',
    body: JSON.stringify({ id, ...patch }),
  });
  return normEntry(r.entry);
}

export async function deleteEntry(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/diary?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function addWater(date: string, amountMl: number): Promise<number> {
  const r = await request<{ water_ml: number }>('/api/diary', {
    method: 'POST',
    body: JSON.stringify({ type: 'water', date, amount_ml: amountMl }),
  });
  return Number(r.water_ml);
}

// ---------- Дні ведення щоденника ----------

export async function getLoggedDays(): Promise<string[]> {
  const r = await request<{ days: string[] }>('/api/days');
  return r.days;
}

// ---------- Продукти: штрихкод, пошук, нещодавні ----------

export interface Food {
  id: string | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  country: string | null;
  image_url: string | null;
  kcal_100: number | null;
  protein_100: number | null;
  fat_100: number | null;
  carbs_100: number | null;
  fiber_100?: number | null;
  sugar_100?: number | null;
  salt_100?: number | null;
  /** Порція збереженого продукту (null — не задано) */
  portion_g?: number | null;
  portion_name?: string | null;
  source: 'saved' | 'openfoodfacts' | 'usda';
  kcal_from_kj: boolean;
  suspicious: boolean;
}

export type BarcodeLookup =
  | { status: 'found'; product: Food }
  | { status: 'not_found' | 'unavailable' };

export function lookupBarcode(code: string): Promise<BarcodeLookup> {
  return request<BarcodeLookup>(`/api/foods?barcode=${encodeURIComponent(code)}`);
}

export interface SearchResult {
  saved: Food[];
  /** Звичайні продукти без штрихкодів (USDA FoodData Central) */
  usda: Food[];
  off: Food[];
  off_error: boolean;
  /** ok — шукали; skipped — запит не схожий на звичайний продукт; error/no_key — база недоступна */
  usda_status: 'ok' | 'skipped' | 'error' | 'no_key';
}

export function searchFoods(q: string): Promise<SearchResult> {
  return request(`/api/foods?q=${encodeURIComponent(q)}`);
}

export async function recentFoods(): Promise<Food[]> {
  const r = await request<{ saved: Food[] }>('/api/foods?recent=1');
  return r.saved;
}

// ---------- Власні страви ----------

export interface Recipe {
  id: string;
  name: string;
  image_data: string | null;
  /** Вага готової страви, якщо вказана вручну */
  total_weight_g: number | null;
  is_public?: boolean;
  category?: Category | null;
  /** Коментар автора цієї страви */
  note?: string | null;
  /** Знімок коментаря автора оригіналу (лише для читання) */
  source_note?: string | null;
  ingredients: Ingredient[];
}

export type Category = 'breakfast' | 'soup' | 'main' | 'drink' | 'bakery' | 'snack' | 'dessert';
export const CATEGORIES: Category[] = ['breakfast', 'soup', 'main', 'drink', 'bakery', 'snack', 'dessert'];

/** Невідома (стара) категорія → null, тобто «Без категорії» */
export const normCategory = (c: unknown): Category | null =>
  typeof c === 'string' && (CATEGORIES as string[]).includes(c) ? (c as Category) : null;

export async function getRecipes(): Promise<Recipe[]> {
  const r = await request<{ recipes: Recipe[] }>('/api/recipes');
  return r.recipes;
}

export interface RecipeInput {
  id?: string;
  name: string;
  /** undefined — не змінювати фото, null — прибрати */
  image_data?: string | null;
  total_weight_g: number | null;
  is_public?: boolean;
  category?: Category | null;
  /** Коментар автора страви (до 500 символів); undefined — не змінювати, null — прибрати */
  note?: string | null;
  /** Лише для нової страви-копії: з якої публічної страви скопійовано */
  source_id?: string | null;
  ingredients: Ingredient[];
}

export async function saveRecipe(input: RecipeInput): Promise<void> {
  await request<{ id: string }>('/api/recipes', {
    method: input.id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
}

/** Страва із загальної бібліотеки: без автора й без посилань на чужі продукти */
export interface SharedRecipe extends Recipe {
  copies_count: number;
  created_at: string;
}

/** category: ключ категорії, 'none' — без категорії, '' — усі */
export async function getShared(q: string, offset: number, category = ''): Promise<{ items: SharedRecipe[]; has_more: boolean }> {
  return request(`/api/shared?q=${encodeURIComponent(q)}&offset=${offset}&category=${encodeURIComponent(category)}`);
}

/** Додати чужу страву до своїх (незалежна копія). already — копія вже була, дубль не створено */
export async function copyShared(id: string): Promise<{ id: string; already: boolean }> {
  return request('/api/shared', { method: 'POST', body: JSON.stringify({ type: 'copy', id }) });
}

export async function deleteRecipe(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/recipes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------- Історія для календаря ----------

export async function getHistory(month: string): Promise<{ entries: Entry[]; goals: GoalRow[] }> {
  const r = await request<{ entries: Entry[]; goals: GoalRow[] }>(
    `/api/history?month=${encodeURIComponent(month)}`,
  );
  return { entries: r.entries.map(normEntry), goals: r.goals };
}

// ---------- Швидке додавання ----------

/** Скопіювати день (без from_meal/to_meal) або один прийом їжі в інший день/прийом */
export async function copyEntries(p: {
  date: string;
  from_date: string;
  from_meal?: Meal;
  to_meal?: Meal;
}): Promise<number> {
  const r = await request<{ copied: number }>('/api/diary', {
    method: 'POST',
    body: JSON.stringify({ type: 'copy', ...p }),
  });
  return r.copied;
}

export interface FrequentFood extends Food {
  /** Остання використана кількість, г */
  last_amount_g: number;
  /** У скількох різних днях продукт додавали */
  days: number;
}

export async function frequentFoods(): Promise<FrequentFood[]> {
  const r = await request<{ items: FrequentFood[] }>('/api/foods?frequent=1');
  return r.items.map((i) => ({ ...i, last_amount_g: Number(i.last_amount_g) }));
}

export interface TemplateItem {
  name: string;
  amount_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
}

export interface MealTemplate {
  id: string;
  name: string;
  items: TemplateItem[];
}

export async function getTemplates(): Promise<MealTemplate[]> {
  const r = await request<{ templates: MealTemplate[] }>('/api/templates');
  return r.templates;
}

export async function createTemplate(p: { name: string; date: string; meal: Meal }): Promise<void> {
  await request('/api/templates', { method: 'POST', body: JSON.stringify({ type: 'create', ...p }) });
}

export async function applyTemplate(p: { id: string; date: string; meal: Meal }): Promise<number> {
  const r = await request<{ added: number }>('/api/templates', {
    method: 'POST',
    body: JSON.stringify({ type: 'apply', ...p }),
  });
  return r.added;
}

export async function deleteTemplate(id: string): Promise<void> {
  await request(`/api/templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------- Вага та нагадування ----------

export async function getWeightLogs(): Promise<WeightLog[]> {
  const r = await request<{ logs: WeightLog[] }>('/api/weight');
  return r.logs.map((l) => ({ log_date: l.log_date, weight_kg: Number(l.weight_kg) }));
}

export async function logWeight(date: string, weightKg: number): Promise<Profile> {
  const r = await request<{ profile: Profile }>('/api/weight', {
    method: 'POST',
    body: JSON.stringify({ date, weight_kg: weightKg }),
  });
  return r.profile;
}

export async function deleteWeight(date: string): Promise<Profile> {
  const r = await request<{ profile: Profile }>(`/api/weight?date=${encodeURIComponent(date)}`, {
    method: 'DELETE',
  });
  return r.profile;
}

export async function saveSettings(patch: {
  remind_diary?: boolean;
  remind_weight?: boolean;
  remind_review?: boolean;
  tz?: string;
}): Promise<Profile> {
  const r = await request<{ profile: Profile }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  return r.profile;
}

export async function getRange(from: string, to: string): Promise<{ entries: Entry[]; goals: GoalRow[] }> {
  const r = await request<{ entries: Entry[]; goals: GoalRow[] }>(
    `/api/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  return { entries: r.entries.map(normEntry), goals: r.goals };
}
