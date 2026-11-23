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
