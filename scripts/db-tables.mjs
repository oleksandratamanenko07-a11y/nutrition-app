// Таблиці застосунку в порядку відновлення (спочатку ті, на які посилаються інші) і їхні первинні ключі.
export const TABLES = [
  { name: 'profiles', pk: ['telegram_id'] },
  { name: 'foods', pk: ['id'] },
  { name: 'recipes', pk: ['id'] },
  { name: 'recipe_ingredients', pk: ['id'] },
  { name: 'diary_entries', pk: ['id'] },
  { name: 'water_logs', pk: ['id'] },
  { name: 'weight_logs', pk: ['id'] },
  { name: 'logged_days', pk: ['owner_id', 'day'] },
  { name: 'goal_history', pk: ['owner_id', 'effective_from'] },
  { name: 'meal_templates', pk: ['id'] },
  { name: 'pairs', pk: ['id'] },
  { name: 'pair_members', pk: ['telegram_id'] },
  { name: 'pair_invites', pk: ['code'] },
  { name: 'shopping_lists', pk: ['id'] },
  { name: 'shopping_items', pk: ['id'] },
];

export function headers(key) {
  const h = { apikey: key, Accept: 'application/json' };
  // Класичні ключі — JWT і потребують Authorization; нові sb_secret_... — лише apikey
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

/** Адреса проєкту без зайвого: пробілів, кінцевих слешів і /rest/v1 (Supabase показує Data API саме з ним) */
export function baseUrl(raw) {
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '').replace(/\/+$/, '');
}
