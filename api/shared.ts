import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';

const PAGE = 15;

/** Прибирає символи, що мають особливе значення в шаблонах ilike */
const likeSafe = (s: string) => s.replace(/[\\%_,()*]/g, ' ').replace(/\s+/g, ' ').trim();

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Загальна бібліотека страв (лише читання; нові дії додаються наступними етапами).
 *   GET /api/shared?q=...&offset=0   — опубліковані страви інших користувачів
 *
 * Безпека: owner_id не вибирається і не віддається, food_id інгредієнтів теж (це посилання на чужу базу).
 * Автор анонімний. Власні страви користувача тут не показуємо — вони в розділі «Мої».
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  try {
    const supabase = db();
    if (req.method === 'GET') {
      const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
      const offset = Math.max(0, Math.min(5000, Number.parseInt(one(req.query.offset), 10) || 0));
      const tokens = likeSafe(one(req.query.q)).split(' ').filter(Boolean).slice(0, 5);

      let query = supabase
        .from('recipes')
        .select('id,name,image_data,total_weight_g,category,copies_count,created_at')
        .eq('is_public', true)
        .neq('owner_id', user.id);
      for (const tk of tokens) query = query.ilike('name', `%${tk}%`);
      const { data: rows, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE); // на одну більше, щоб знати, чи є ще
      if (error) throw error;

      const page = (rows ?? []).slice(0, PAGE) as Record<string, unknown>[];
      const ids = page.map((r) => r.id as string);
      let ings: Record<string, unknown>[] = [];
      if (ids.length) {
        const { data, error: ie } = await supabase
          .from('recipe_ingredients')
          .select('recipe_id,name,amount_g,kcal_100,protein_100,fat_100,carbs_100,fiber_100,sugar_100,salt_100,position')
          .in('recipe_id', ids)
          .order('position', { ascending: true });
        if (ie) throw ie;
        ings = (data ?? []) as Record<string, unknown>[];
      }
      return res.status(200).json({
        items: page.map((r) => ({
          id: r.id,
          name: r.name,
          image_data: r.image_data ?? null,
          total_weight_g: num(r.total_weight_g),
          category: r.category ?? null,
          copies_count: Number(r.copies_count ?? 0),
          created_at: r.created_at,
          ingredients: ings
            .filter((i) => i.recipe_id === r.id)
            .map((i) => ({
              food_id: null,
              name: i.name,
              amount_g: Number(i.amount_g),
              kcal_100: num(i.kcal_100),
              protein_100: num(i.protein_100),
              fat_100: num(i.fat_100),
              carbs_100: num(i.carbs_100),
              fiber_100: num(i.fiber_100),
              sugar_100: num(i.sugar_100),
              salt_100: num(i.salt_100),
            })),
        })),
        has_more: (rows ?? []).length > PAGE,
      });
    }
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('shared api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
