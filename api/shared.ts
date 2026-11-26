import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';
import { refreshCopies } from './_lib/library.js';

const PAGE = 15;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RECIPES = 200;

/** Прибирає символи, що мають особливе значення в шаблонах ilike */
const likeSafe = (s: string) => s.replace(/[\\%_,()*]/g, ' ').replace(/\s+/g, ' ').trim();

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Загальна бібліотека страв.
 *   GET  /api/shared?q=...&offset=0    — опубліковані страви інших користувачів
 *   POST /api/shared {type:'copy', id} — додати страву до своїх (незалежна копія, без дублів)
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

    if (req.method === 'POST') {
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (b.type !== 'copy') return res.status(400).json({ error: 'invalid_data' });
      const id = typeof b.id === 'string' && UUID_RE.test(b.id) ? b.id : null;
      if (!id) return res.status(400).json({ error: 'invalid_data' });

      // Повторне натискання: копія вже є — повертаємо її, нову не створюємо
      const existing = async () => {
        const { data, error } = await supabase
          .from('recipes').select('id').eq('owner_id', user.id).eq('saved_from', id).maybeSingle();
        if (error) throw error;
        return data?.id as string | undefined;
      };
      const had = await existing();
      if (had) return res.status(200).json({ id: had, already: true });

      // Копіювати можна лише опубліковану страву іншого користувача
      const { data: src, error: se } = await supabase
        .from('recipes')
        .select('id,name,image_data,total_weight_g,category')
        .eq('id', id).eq('is_public', true).neq('owner_id', user.id)
        .maybeSingle();
      if (se) throw se;
      if (!src) return res.status(404).json({ error: 'not_found' });

      const { count, error: ce } = await supabase
        .from('recipes').select('id', { count: 'exact', head: true }).eq('owner_id', user.id);
      if (ce) throw ce;
      if ((count ?? 0) >= MAX_RECIPES) return res.status(409).json({ error: 'limit' });

      const { data: ings, error: ie } = await supabase
        .from('recipe_ingredients')
        .select('name,amount_g,kcal_100,protein_100,fat_100,carbs_100,fiber_100,sugar_100,salt_100,position')
        .eq('recipe_id', id)
        .order('position', { ascending: true });
      if (ie) throw ie;
      if (!ings || ings.length === 0) return res.status(404).json({ error: 'not_found' });

      // Копія — незалежна страва власника; за замовчуванням особиста (щоб випадково не публікувати чуже вдруге)
      const { data: rec, error: re } = await supabase
        .from('recipes')
        .insert({
          owner_id: user.id, name: src.name, image_data: src.image_data, total_weight_g: src.total_weight_g,
          category: src.category, is_public: false, source_id: id, saved_from: id,
        })
        .select('id')
        .single();
      if (re) {
        if ((re as { code?: string }).code === '23505') {
          const again = await existing(); // одночасний запит уже створив копію
          if (again) return res.status(200).json({ id: again, already: true });
        }
        throw re;
      }
      const { error: ii } = await supabase.from('recipe_ingredients').insert(
        ings.map((i: Record<string, unknown>, idx: number) => ({ ...i, recipe_id: rec.id, food_id: null, position: idx })),
      );
      if (ii) {
        await supabase.from('recipes').delete().eq('id', rec.id).eq('owner_id', user.id);
        throw ii;
      }
      await refreshCopies(supabase, id);
      return res.status(200).json({ id: rec.id, already: false });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('shared api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
