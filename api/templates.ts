import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';
import { cleanTemplateItems, orderedTimestamps, toTemplateItems, type EntryRow } from './_lib/quick.js';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEMPLATES = 30;
const invalid = (res: VercelResponse) => res.status(400).json({ error: 'invalid_data' });

function notFuture(date: string): boolean {
  return date <= new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Шаблони прийомів їжі.
 *   GET                              список шаблонів
 *   POST {type:'create', name, date, meal}   зберегти записи прийому їжі як шаблон
 *   POST {type:'apply', id, date, meal}      додати шаблон у щоденник
 *   DELETE ?id=...                           видалити шаблон
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  try {
    const supabase = db();
    const uid = user.id;

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('meal_templates')
        .select('id,name,items,created_at')
        .eq('owner_id', uid)
        .order('created_at', { ascending: false })
        .limit(MAX_TEMPLATES);
      if (error) throw error;
      return res.status(200).json({ templates: data ?? [] });
    }

    if (req.method === 'POST') {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const date = typeof b.date === 'string' && DATE_RE.test(b.date) ? b.date : null;
      const meal = typeof b.meal === 'string' && MEALS.includes(b.meal) ? b.meal : null;
      if (!date || !meal) return invalid(res);

      if (b.type === 'create') {
        const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
        if (name.length < 1 || name.length > 60) return invalid(res);

        const { count, error: countError } = await supabase
          .from('meal_templates')
          .select('id', { count: 'exact', head: true })
          .eq('owner_id', uid);
        if (countError) throw countError;
        if ((count ?? 0) >= MAX_TEMPLATES) return res.status(409).json({ error: 'limit' });

        const { data: rows, error } = await supabase
          .from('diary_entries')
          .select('*')
          .eq('owner_id', uid)
          .eq('entry_date', date)
          .eq('meal', meal)
          .order('created_at', { ascending: true })
          .limit(100);
        if (error) throw error;
        if (!rows || rows.length === 0) return invalid(res);

        const items = toTemplateItems(rows as EntryRow[]);
        const { data: tpl, error: insError } = await supabase
          .from('meal_templates')
          .insert({ owner_id: uid, name, items })
          .select('id,name,items,created_at')
          .single();
        if (insError) throw insError;
        return res.status(200).json({ template: tpl });
      }

      if (b.type === 'apply') {
        if (!notFuture(date)) return invalid(res);
        const id = typeof b.id === 'string' && UUID_RE.test(b.id) ? b.id : null;
        if (!id) return invalid(res);

        const { data: tpl, error } = await supabase
          .from('meal_templates')
          .select('items')
          .eq('id', id)
          .eq('owner_id', uid)
          .maybeSingle();
        if (error) throw error;
        if (!tpl) return res.status(404).json({ error: 'not_found' });
        const items = cleanTemplateItems(tpl.items);
        if (!items) return invalid(res);

        const stamps = orderedTimestamps(items.length);
        const { error: insError } = await supabase.from('diary_entries').insert(
          items.map((i, idx) => ({
            owner_id: uid,
            entry_date: date,
            meal,
            food_id: i.food_id,
            name: i.name,
            amount_g: i.amount_g,
            kcal_100: i.kcal_100,
            protein_100: i.protein_100,
            fat_100: i.fat_100,
            carbs_100: i.carbs_100,
            recipe_snapshot: i.recipe_snapshot,
            created_at: stamps[idx],
          })),
        );
        if (insError) throw insError;

        const { error: dayError } = await supabase
          .from('logged_days')
          .upsert({ owner_id: uid, day: date }, { onConflict: 'owner_id,day', ignoreDuplicates: true });
        if (dayError) console.error('logged_days error', dayError);
        return res.status(200).json({ added: items.length });
      }

      return invalid(res);
    }

    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' && UUID_RE.test(req.query.id) ? req.query.id : null;
      if (!id) return invalid(res);
      const { error } = await supabase.from('meal_templates').delete().eq('id', id).eq('owner_id', uid);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('templates api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
