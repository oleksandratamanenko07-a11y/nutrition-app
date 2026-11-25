import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return null;
  return v;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
/** Дата не може бути пізніше ніж «завтра» за UTC (запас на часові пояси). */
function notFuture(date: string): boolean {
  return date <= new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
}

const invalid = (res: VercelResponse) => res.status(400).json({ error: 'invalid_data' });

/**
 * Щоденник харчування і вода.
 *   GET    ?date=РРРР-ММ-ДД          записи дня + випита вода
 *   POST   {type:'entry', ...}       додати продукт у щоденник
 *   POST   {type:'water', ...}       додати/прибрати воду
 *   PATCH  {id, amount_g?, meal?}    змінити кількість / перенести
 *   DELETE ?id=...                   видалити запис
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  try {
    const supabase = db();
    const uid = user.id;

    if (req.method === 'GET') {
      const date = typeof req.query.date === 'string' ? req.query.date : '';
      if (!DATE_RE.test(date)) return invalid(res);

      const [entries, water] = await Promise.all([
        supabase
          .from('diary_entries')
          .select('*')
          .eq('owner_id', uid)
          .eq('entry_date', date)
          .order('created_at', { ascending: true }),
        supabase.from('water_logs').select('amount_ml').eq('owner_id', uid).eq('log_date', date),
      ]);
      if (entries.error) throw entries.error;
      if (water.error) throw water.error;

      const waterMl = (water.data ?? []).reduce(
        (s: number, r: { amount_ml: number }) => s + r.amount_ml,
        0,
      );
      return res.status(200).json({ entries: entries.data ?? [], water_ml: waterMl });
    }

    if (req.method === 'POST') {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const date = typeof b.date === 'string' && DATE_RE.test(b.date) ? b.date : null;
      if (!date || !notFuture(date)) return invalid(res);

      if (b.type === 'water') {
        const amount = num(b.amount_ml, -3000, 3000);
        if (amount === null || !Number.isInteger(amount) || amount === 0) return invalid(res);

        const { data: rows, error } = await supabase
          .from('water_logs')
          .select('amount_ml')
          .eq('owner_id', uid)
          .eq('log_date', date);
        if (error) throw error;
        const total = (rows ?? []).reduce(
          (s: number, r: { amount_ml: number }) => s + r.amount_ml,
          0,
        );
        // Сума води за день не може піти нижче нуля
        const delta = Math.max(amount, -total);
        if (delta !== 0) {
          const { error: insertError } = await supabase
            .from('water_logs')
            .insert({ owner_id: uid, log_date: date, amount_ml: delta });
          if (insertError) throw insertError;
        }
        return res.status(200).json({ water_ml: total + delta });
      }

      if (b.type === 'entry') {
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        const meal = typeof b.meal === 'string' && MEALS.includes(b.meal) ? b.meal : null;
        const grams = num(b.amount_g, 0.01, 5000);
        const kcal = num(b.kcal_100, 0, 900);
        const protein = num(b.protein_100, 0, 100);
        const fat = num(b.fat_100, 0, 100);
        const carbs = num(b.carbs_100, 0, 100);
        if (
          name.length < 1 || name.length > 120 || !meal ||
          grams === null || kcal === null || protein === null || fat === null || carbs === null
        ) {
          return invalid(res);
        }
        if (protein + fat + carbs > 105) return invalid(res);

        const values = {
          kcal_100: round2(kcal),
          protein_100: round2(protein),
          fat_100: round2(fat),
          carbs_100: round2(carbs),
        };

        // Додаткові дані про продукт (зі сканера / Open Food Facts) — необов'язкові
        const text = (v: unknown, max: number): string | null =>
          typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
        const barcode = typeof b.barcode === 'string' && /^\d{8,14}$/.test(b.barcode) ? b.barcode : null;
        const brand = text(b.brand, 80);
        const country = text(b.country, 80);
        const image = typeof b.image_url === 'string' && /^https:\/\//.test(b.image_url) && b.image_url.length <= 500
          ? b.image_url
          : null;
        const source = b.source === 'openfoodfacts' ? 'openfoodfacts' : b.source === 'recipe' ? 'recipe' : 'manual';
        const details = { barcode, brand, country, image_url: image, source };

        // Продукт зберігаємо в особисту базу (без дублікатів).
        // За штрихкодом шукаємо спершу: виправлення користувача оновлюють збережений продукт.
        let existingId: string | null = null;
        if (barcode) {
          const { data: byCode, error: codeError } = await supabase
            .from('foods')
            .select('id')
            .eq('owner_id', uid)
            .eq('barcode', barcode)
            .limit(1)
            .maybeSingle();
          if (codeError) throw codeError;
          existingId = byCode?.id ?? null;
        }
        if (!existingId) {
          const { data: byName, error: findError } = await supabase
            .from('foods')
            .select('id')
            .eq('owner_id', uid)
            .eq('name', name)
            .eq('kcal_100', values.kcal_100)
            .eq('protein_100', values.protein_100)
            .eq('fat_100', values.fat_100)
            .eq('carbs_100', values.carbs_100)
            .limit(1)
            .maybeSingle();
          if (findError) throw findError;
          existingId = byName?.id ?? null;
        }

        let foodId: string | null = existingId;
        const now = new Date().toISOString();
        if (foodId) {
          const patch: Record<string, unknown> = { last_used_at: now, name, ...values };
          if (barcode) Object.assign(patch, details);
          if (source === 'manual') delete patch.source; // не затираємо походження збереженого продукту
          const { error: upError } = await supabase.from('foods').update(patch).eq('id', foodId).eq('owner_id', uid);
          if (upError) throw upError;
        } else {
          const { data: food, error: foodError } = await supabase
            .from('foods')
            .insert({ owner_id: uid, name, last_used_at: now, ...values, ...details })
            .select('id')
            .single();
          if (foodError) throw foodError;
          foodId = food.id;
        }

        // Склад страви на момент додавання: правка страви потім не змінює цей запис
        let snapshot: unknown = null;
        if (source === 'recipe' && Array.isArray(b.recipe_snapshot) && b.recipe_snapshot.length <= 30) {
          const items = (b.recipe_snapshot as Record<string, unknown>[]).map((i) => ({
            name: typeof i?.name === 'string' ? i.name.slice(0, 120) : '',
            amount_g: num(i?.amount_g, 0, 5000),
            kcal_100: num(i?.kcal_100, 0, 900),
            protein_100: num(i?.protein_100, 0, 100),
            fat_100: num(i?.fat_100, 0, 100),
            carbs_100: num(i?.carbs_100, 0, 100),
          }));
          if (items.every((i) => i.name && i.amount_g !== null)) snapshot = items;
        }

        const { data: entry, error: entryError } = await supabase
          .from('diary_entries')
          .insert({
            recipe_snapshot: snapshot,
            owner_id: uid,
            entry_date: date,
            meal,
            food_id: foodId,
            name,
            amount_g: round2(grams),
            ...values,
          })
          .select('*')
          .single();
        if (entryError) throw entryError;

        // День ведення щоденника: один календарний день рахується один раз,
        // а при видаленні записів загальна кількість днів не зменшується.
        const { error: dayError } = await supabase
          .from('logged_days')
          .upsert({ owner_id: uid, day: date }, { onConflict: 'owner_id,day', ignoreDuplicates: true });
        if (dayError) console.error('logged_days error', dayError);

        return res.status(200).json({ entry });
      }

      return invalid(res);
    }

    if (req.method === 'PATCH') {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const id = typeof b.id === 'string' && UUID_RE.test(b.id) ? b.id : null;
      if (!id) return invalid(res);

      const patch: Record<string, unknown> = {};
      if (b.amount_g !== undefined) {
        const grams = num(b.amount_g, 0.01, 5000);
        if (grams === null) return invalid(res);
        patch.amount_g = round2(grams);
      }
      if (b.meal !== undefined) {
        if (typeof b.meal !== 'string' || !MEALS.includes(b.meal)) return invalid(res);
        patch.meal = b.meal;
      }
      if (Object.keys(patch).length === 0) return invalid(res);

      const { data, error } = await supabase
        .from('diary_entries')
        .update(patch)
        .eq('id', id)
        .eq('owner_id', uid)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ entry: data });
    }

    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' && UUID_RE.test(req.query.id) ? req.query.id : null;
      if (!id) return invalid(res);
      const { error } = await supabase.from('diary_entries').delete().eq('id', id).eq('owner_id', uid);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('diary api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
