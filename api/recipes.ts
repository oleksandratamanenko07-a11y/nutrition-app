import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';
import { parseExtras, type Extras } from './_lib/extras.js';
import { refreshCopies } from './_lib/library.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'];
const IMG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

interface IngredientIn {
  food_id: string | null;
  name: string;
  amount_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
  extras: Extras;
}

function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return null;
  return v;
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Перевіряє тіло запиту. Усі значення харчової цінності обов'язкові: нулі не підставляються. */
function parseBody(b: Record<string, unknown>) {
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 1 || name.length > 80) return null;

  let image: string | null = null;
  if (b.image_data !== undefined && b.image_data !== null) {
    if (typeof b.image_data !== 'string' || b.image_data.length > 150_000 || !IMG_RE.test(b.image_data)) return null;
    image = b.image_data;
  }

  let weight: number | null = null;
  if (b.total_weight_g !== undefined && b.total_weight_g !== null) {
    weight = num(b.total_weight_g, 1, 20000);
    if (weight === null) return null;
  }

  if (!Array.isArray(b.ingredients) || b.ingredients.length < 1 || b.ingredients.length > 30) return null;
  const ingredients: IngredientIn[] = [];
  for (const raw of b.ingredients as Record<string, unknown>[]) {
    const iname = typeof raw?.name === 'string' ? raw.name.trim() : '';
    const grams = num(raw?.amount_g, 0.01, 5000);
    const kcal = num(raw?.kcal_100, 0, 900);
    const protein = num(raw?.protein_100, 0, 100);
    const fat = num(raw?.fat_100, 0, 100);
    const carbs = num(raw?.carbs_100, 0, 100);
    if (!iname || iname.length > 120 || grams === null || kcal === null || protein === null || fat === null || carbs === null) {
      return null;
    }
    const fid = typeof raw.food_id === 'string' && UUID_RE.test(raw.food_id) ? raw.food_id : null;
    ingredients.push({
      food_id: fid, name: iname, amount_g: r2(grams),
      kcal_100: r2(kcal), protein_100: r2(protein), fat_100: r2(fat), carbs_100: r2(carbs),
      extras: parseExtras(raw),
    });
  }
  let category: string | null = null;
  if (b.category !== undefined && b.category !== null && b.category !== '') {
    if (typeof b.category !== 'string' || !CATEGORIES.includes(b.category)) return null;
    category = b.category;
  }
  // is_public: не передали — undefined (не чіпаємо при зміні, true для нової страви)
  let isPublic: boolean | undefined;
  if (b.is_public !== undefined) {
    if (typeof b.is_public !== 'boolean') return null;
    isPublic = b.is_public;
  }
  const sourceId = typeof b.source_id === 'string' && UUID_RE.test(b.source_id) ? b.source_id : null;
  return { name, image, weight, ingredients, category, isPublic, sourceId };
}

/**
 * GET    /api/recipes           — усі страви користувача із складом
 * POST   /api/recipes           — створити
 * PUT    /api/recipes           — змінити (id у тілі)
 * DELETE /api/recipes?id=...    — видалити
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const invalid = () => res.status(400).json({ error: 'invalid_data' });

  try {
    const supabase = db();
    const uid = user.id;

    if (req.method === 'GET') {
      const { data: recipes, error } = await supabase
        .from('recipes')
        .select('id,name,image_data,total_weight_g,is_public,category,created_at')
        .eq('owner_id', uid)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const ids = (recipes ?? []).map((r: { id: string }) => r.id);
      let ings: Record<string, unknown>[] = [];
      if (ids.length) {
        const { data, error: ie } = await supabase
          .from('recipe_ingredients')
          .select('recipe_id,food_id,name,amount_g,kcal_100,protein_100,fat_100,carbs_100,fiber_100,sugar_100,salt_100,position')
          .in('recipe_id', ids)
          .order('position', { ascending: true });
        if (ie) throw ie;
        ings = (data ?? []) as Record<string, unknown>[];
      }
      const num2 = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return res.status(200).json({
        recipes: (recipes ?? []).map((r: Record<string, unknown>) => ({
          id: r.id,
          name: r.name,
          image_data: r.image_data ?? null,
          total_weight_g: num2(r.total_weight_g),
          is_public: r.is_public !== false,
          category: r.category ?? null,
          ingredients: ings
            .filter((i) => i.recipe_id === r.id)
            .map((i) => ({
              food_id: i.food_id ?? null,
              name: i.name,
              amount_g: Number(i.amount_g),
              kcal_100: num2(i.kcal_100),
              protein_100: num2(i.protein_100),
              fat_100: num2(i.fat_100),
              carbs_100: num2(i.carbs_100),
              fiber_100: num2(i.fiber_100),
              sugar_100: num2(i.sugar_100),
              salt_100: num2(i.salt_100),
            })),
        })),
      });
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const p = parseBody(body);
      if (!p) return invalid();

      // Посилання на продукти приймаємо лише на власні
      const fids = [...new Set(p.ingredients.map((i) => i.food_id).filter((x): x is string => !!x))];
      let owned = new Set<string>();
      if (fids.length) {
        const { data, error } = await supabase.from('foods').select('id').eq('owner_id', uid).in('id', fids);
        if (error) throw error;
        owned = new Set((data ?? []).map((r: { id: string }) => r.id));
      }
      const rows = (recipeId: string) =>
        p.ingredients.map((i, idx) => ({
          recipe_id: recipeId,
          food_id: i.food_id && owned.has(i.food_id) ? i.food_id : null,
          name: i.name,
          amount_g: i.amount_g,
          kcal_100: i.kcal_100,
          protein_100: i.protein_100,
          fat_100: i.fat_100,
          carbs_100: i.carbs_100,
          ...i.extras,
          position: idx,
        }));

      if (req.method === 'POST') {
        // Звідки скопійовано: лише якщо оригінал публічний (інакше посилання ігноруємо)
        let sourceId: string | null = null;
        if (p.sourceId) {
          const { data: s } = await supabase
            .from('recipes').select('id').eq('id', p.sourceId).eq('is_public', true).maybeSingle();
          sourceId = s?.id ?? null;
        }
        const { data: rec, error } = await supabase
          .from('recipes')
          .insert({
            owner_id: uid, name: p.name, image_data: p.image, total_weight_g: p.weight,
            category: p.category, is_public: p.isPublic ?? true, source_id: sourceId,
          })
          .select('id')
          .single();
        if (error) throw error;
        const { error: ie } = await supabase.from('recipe_ingredients').insert(rows(rec.id));
        if (ie) {
          await supabase.from('recipes').delete().eq('id', rec.id).eq('owner_id', uid);
          throw ie;
        }
        if (sourceId) await refreshCopies(supabase, sourceId);
        return res.status(200).json({ id: rec.id });
      }

      const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null;
      if (!id) return invalid();
      const { data: own, error: oe } = await supabase
        .from('recipes').select('id').eq('id', id).eq('owner_id', uid).maybeSingle();
      if (oe) throw oe;
      if (!own) return res.status(404).json({ error: 'not_found' });

      // Спершу додаємо новий склад і лише потім видаляємо старий — щоб не втратити дані при збої
      const { data: oldRows, error: le } = await supabase
        .from('recipe_ingredients').select('id').eq('recipe_id', id);
      if (le) throw le;
      const { error: ie } = await supabase.from('recipe_ingredients').insert(rows(id));
      if (ie) throw ie;
      const oldIds = (oldRows ?? []).map((r: { id: string }) => r.id);
      if (oldIds.length) {
        const { error: de } = await supabase.from('recipe_ingredients').delete().in('id', oldIds);
        if (de) throw de;
      }
      const patch: Record<string, unknown> = {
        name: p.name, total_weight_g: p.weight, category: p.category, updated_at: new Date().toISOString(),
      };
      if (p.isPublic !== undefined) patch.is_public = p.isPublic;
      // image_data: передали значення — оновлюємо (null = прибрати фото); не передали — не чіпаємо
      if (body.image_data !== undefined) patch.image_data = p.image;
      const { error: ue } = await supabase.from('recipes').update(patch).eq('id', id).eq('owner_id', uid);
      if (ue) throw ue;
      return res.status(200).json({ id });
    }

    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' && UUID_RE.test(req.query.id) ? req.query.id : null;
      if (!id) return invalid();
      const { error } = await supabase.from('recipes').delete().eq('id', id).eq('owner_id', uid);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('recipes api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
