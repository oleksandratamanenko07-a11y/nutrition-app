import { initData } from './telegram';
import type { Activity, Goal, Sex } from './calc';

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
}

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Entry {
  id: string;
  entry_date: string;
  meal: Meal;
  name: string;
  amount_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
}

export interface Day {
  entries: Entry[];
  water_ml: number;
}

export type ApiErrorKind = 'offline' | 'unauthorized' | 'invalid' | 'server';

export class ApiError extends Error {
  kind: ApiErrorKind;
  constructor(kind: ApiErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  if (res.status === 401) throw new ApiError('unauthorized');
  if (res.status === 400) throw new ApiError('invalid');
  if (!res.ok) throw new ApiError('server');
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
  };
}

export async function getDay(date: string): Promise<Day> {
  const r = await request<{ entries: Entry[]; water_ml: number }>(
    `/api/diary?date=${encodeURIComponent(date)}`,
  );
  return { entries: r.entries.map(normEntry), water_ml: Number(r.water_ml) };
}

export interface NewEntry {
  date: string;
  meal: Meal;
  name: string;
  amount_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
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
