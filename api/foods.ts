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

const OFF_BASE = 'https://world.openfoodfacts.org';

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
    source: 'saved',
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

    const q = one(req.query.q).trim().slice(0, 60);
    if (q) {
      if (q.length < 2) return res.status(400).json({ error: 'invalid_data' });
      const like = `%${q.replace(/[%_\\,()]/g, ' ')}%`;

      const savedPromise = supabase
        .from('foods')
        .select('*')
        .eq('owner_id', uid)
        .ilike('name', like)
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .limit(10);

      const offPromise = (async (): Promise<{ items: FoodProduct[]; error: boolean }> => {
        try {
          const url =
            `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
            `&search_simple=1&action=process&json=1&page_size=15&fields=${OFF_FIELDS}`;
          const r = await offGet(url);
          if (!r.ok) return { items: [], error: true };
          const json = (await r.json()) as { products?: unknown[] };
          const items = (json.products ?? [])
            .map((p) => parseOffProduct(p))
            .filter((p): p is FoodProduct => p !== null);
          return { items, error: false };
        } catch {
          return { items: [], error: true };
        }
      })();

      const [saved, off] = await Promise.all([savedPromise, offPromise]);
      if (saved.error) throw saved.error;
      return res.status(200).json({
        saved: (saved.data ?? []).map((r) => fromRow(r as FoodRow)),
        off: off.items,
        off_error: off.error,
      });
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
