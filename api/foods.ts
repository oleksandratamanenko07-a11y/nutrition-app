import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';
import {
  flagSuspicious,
  OFF_FIELDS,
  OFF_USER_AGENT,
  parseOffProduct,
  type FoodProduct,
} from './_lib/off.js';
import { normalizeQuery, rankByTokens, tokenize } from './_lib/search.js';
import { aggregateFrequent, type EntryRow } from './_lib/quick.js';
import { parseUsdaFoods, parseUsdaQuery } from './_lib/usda.js';
import { parseExtras } from './_lib/extras.js';
import { cleanPortion } from './_lib/portion.js';

const OFF_BASE = 'https://world.openfoodfacts.org';
const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';

interface FoodRow {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  country: string | null;
  image_url: string | null;
  kcal_100: number | string | null;
  protein_100: number | string | null;
  fat_100: number | string | null;
  carbs_100: number | string | null;
  fiber_100?: number | string | null;
  sugar_100?: number | string | null;
  salt_100?: number | string | null;
  portion_g?: number | string | null;
  portion_name?: string | null;
  source?: string | null;
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

function fromRow(r: FoodRow): FoodProduct {
  const values = {
    kcal_100: num(r.kcal_100),
    protein_100: num(r.protein_100),
    fat_100: num(r.fat_100),
    carbs_100: num(r.carbs_100),
  };
  return {
    id: r.id,
    barcode: r.barcode,
    name: r.name,
    brand: r.brand,
    country: r.country,
    image_url: r.image_url,
    ...values,
    ...parseExtras(r),
    ...cleanPortion(r.portion_g, r.portion_name),
    source: 'saved',
    origin: r.source ?? null,
    kcal_from_kj: false,
    suspicious: flagSuspicious(values),
  };
}

async function offGet(url: string): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(7000),
  });
}

/**
 * GET /api/foods?barcode=...  — продукт за штрихкодом (спершу свої, потім Open Food Facts)
 * GET /api/foods?q=...        — пошук за назвою (свої + Open Food Facts)
 * GET /api/foods?recent=1     — нещодавно використані продукти
 * GET /api/foods?frequent=1   — продукти, які користувач додає найчастіше (з останньою кількістю)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const supabase = db();
    const uid = user.id;
    const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

    const barcode = one(req.query.barcode);
    if (barcode) {
      if (!/^\d{8,14}$/.test(barcode)) return res.status(400).json({ error: 'invalid_data' });

      const { data: saved, error } = await supabase
        .from('foods')
        .select('*')
        .eq('owner_id', uid)
        .eq('barcode', barcode)
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (saved) return res.status(200).json({ status: 'found', product: fromRow(saved as FoodRow) });

      let r: Response;
      try {
        r = await offGet(`${OFF_BASE}/api/v2/product/${barcode}?fields=${OFF_FIELDS}`);
      } catch {
        return res.status(200).json({ status: 'unavailable' });
      }
      if (r.status === 404) return res.status(200).json({ status: 'not_found' });
      if (!r.ok) return res.status(200).json({ status: 'unavailable' });

      const json = (await r.json()) as { status?: number; product?: unknown };
      const product = json.status === 0 ? null : parseOffProduct(json.product, barcode);
      if (!product) return res.status(200).json({ status: 'not_found' });
      return res.status(200).json({ status: 'found', product });
    }

    if (typeof req.query.q === 'string') {
      const q = normalizeQuery(req.query.q);
      const tokens = tokenize(q);
      // Порожній запит (або лише пробіли) нічого не шукає
      if (tokens.length === 0) return res.status(200).json({ saved: [], off: [], off_error: false });
      if (q.length < 2) return res.status(400).json({ error: 'invalid_data' });

      // Власні продукти: беремо продукти користувача й відбираємо за всіма словами
      // (будь-який порядок слів, без урахування регістру та діакритики)
      const savedPromise = supabase
        .from('foods')
        .select('*')
        .eq('owner_id', uid)
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .limit(1000);

      const offSearch = async (terms: string[]): Promise<FoodProduct[]> => {
        const url =
          `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(terms.join(' '))}` +
          `&search_simple=1&action=process&json=1&page_size=24&fields=${OFF_FIELDS}`;
        const r = await offGet(url);
        if (!r.ok) throw new Error(`off ${r.status}`);
        const json = (await r.json()) as { products?: unknown[] };
        return (json.products ?? [])
          .map((p) => parseOffProduct(p))
          .filter((p): p is FoodProduct => p !== null);
      };
      const offText = (p: FoodProduct) => `${p.name} ${p.brand ?? ''}`;

      const offPromise = (async (): Promise<{ items: FoodProduct[]; error: boolean }> => {
        try {
          let items = rankByTokens(await offSearch(tokens), offText, tokens, true);
          // Якщо за всіма словами нічого немає — пробуємо найбільш конкретні слова (довші)
          if (items.length === 0 && tokens.length > 1) {
            const key = [...tokens].sort((a, b) => b.length - a.length).slice(0, 2);
            items = rankByTokens(await offSearch(key), offText, tokens, false).slice(0, 15);
          }
          return { items: items.slice(0, 15), error: false };
        } catch {
          return { items: [], error: true };
        }
      })();

      // Звичайні продукти без штрихкодів: USDA FoodData Central (ключ лише на сервері)
      const usdaPromise = (async (): Promise<{ items: FoodProduct[]; status: 'ok' | 'error' | 'no_key' | 'skipped' }> => {
        const uq = parseUsdaQuery(q);
        if (!uq) return { items: [], status: 'skipped' };
        const key = process.env.USDA_API_KEY;
        if (!key) return { items: [], status: 'no_key' };
        try {
          const url =
            `${USDA_BASE}/foods/search?api_key=${encodeURIComponent(key)}` +
            `&query=${encodeURIComponent(uq.terms.join(' '))}` +
            `&dataType=Foundation,SR%20Legacy&pageSize=50`;
          const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
          if (!r.ok) return { items: [], status: 'error' };
          return { items: parseUsdaFoods(await r.json(), uq, flagSuspicious), status: 'ok' };
        } catch {
          return { items: [], status: 'error' };
        }
      })();

      const [saved, off, usda] = await Promise.all([savedPromise, offPromise, usdaPromise]);
      if (saved.error) throw saved.error;
      const savedItems = rankByTokens(
        (saved.data ?? []).map((r) => fromRow(r as FoodRow)),
        (p: FoodProduct) => `${p.name} ${p.brand ?? ''}`,
        tokens,
        true,
      ).slice(0, 10);
      // Не дублюємо: те, що вже є в особистій базі (та сама назва й значення), з USDA не показуємо
      const sig = (p: FoodProduct) => [p.name, p.kcal_100, p.protein_100, p.fat_100, p.carbs_100].join('|');
      const have = new Set(savedItems.map(sig));
      return res.status(200).json({
        saved: savedItems,
        usda: usda.items.filter((p) => !have.has(sig(p))),
        off: off.items,
        off_error: off.error,
        usda_status: usda.status,
      });
    }

    if (one(req.query.frequent)) {
      const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const { data: rows, error } = await supabase
        .from('diary_entries')
        .select('food_id,name,meal,amount_g,kcal_100,protein_100,fat_100,carbs_100,fiber_100,sugar_100,salt_100,entry_date,created_at,recipe_snapshot')
        .eq('owner_id', uid)
        .gte('entry_date', since)
        .order('entry_date', { ascending: false })
        .limit(3000);
      if (error) throw error;
      const top = aggregateFrequent((rows ?? []) as EntryRow[], 10, 2);

      const ids = top.map((t) => t.food_id).filter((x): x is string => !!x);
      const foods = new Map<string, FoodRow>();
      if (ids.length > 0) {
        const { data: fr, error: fe } = await supabase.from('foods').select('*').eq('owner_id', uid).in('id', ids);
        if (fe) throw fe;
        for (const f of (fr ?? []) as FoodRow[]) foods.set(f.id, f);
      }
      const items = top.map((t) => {
        const row = t.food_id ? foods.get(t.food_id) : undefined;
        const values = {
          kcal_100: t.kcal_100,
          protein_100: t.protein_100,
          fat_100: t.fat_100,
          carbs_100: t.carbs_100,
        };
        const base: FoodProduct = row
          ? fromRow(row)
          : {
              id: null, barcode: null, name: t.name, brand: null, country: null, image_url: null,
              ...values, fiber_100: t.fiber_100, sugar_100: t.sugar_100, salt_100: t.salt_100,
              source: 'saved', kcal_from_kj: false, suspicious: flagSuspicious(values),
            };
        return { ...base, last_amount_g: t.last_amount_g, days: t.days };
      });
      return res.status(200).json({ items });
    }

    if (one(req.query.recent)) {
      const { data, error } = await supabase
        .from('foods')
        .select('*')
        .eq('owner_id', uid)
        .not('last_used_at', 'is', null)
        .order('last_used_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return res.status(200).json({ saved: (data ?? []).map((r) => fromRow(r as FoodRow)) });
    }

    return res.status(400).json({ error: 'invalid_data' });
  } catch (e) {
    console.error('foods api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
