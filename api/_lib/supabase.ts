import { createClient } from '@supabase/supabase-js';

/** Серверний клієнт Supabase із секретним ключем. Використовується тільки в /api. */
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Не задані SUPABASE_URL або SUPABASE_SECRET_KEY');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
