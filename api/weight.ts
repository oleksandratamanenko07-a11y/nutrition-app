import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const invalid = (res: VercelResponse) => res.status(400).json({ error: 'invalid_data' });

function notFuture(date: string): boolean {
  return date <= new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Історія ваги.
 *   GET                      усі записи ваги (від старих до нових)
 *   POST {date, weight_kg}   записати/оновити вагу за день
 *   DELETE ?date=...         видалити запис
 * Після змін «поточна вага» в профілі = вага з найпізнішого запису.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  try {
    const supabase = db();
    const uid = user.id;

    const syncProfile = async () => {
      const { data: latest, error } = await supabase
        .from('weight_logs')
        .select('weight_kg')
        .eq('owner_id', uid)
        .order('log_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (latest) {
        const { error: upError } = await supabase
          .from('profiles')
          .update({ weight_kg: latest.weight_kg, updated_at: new Date().toISOString() })
          .eq('telegram_id', uid);
        if (upError) throw upError;
      }
      const { data: profile, error: pError } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', uid)
        .single();
      if (pError) throw pError;
      return profile;
    };

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('weight_logs')
        .select('log_date,weight_kg')
        .eq('owner_id', uid)
        .order('log_date', { ascending: true })
        .limit(3000);
      if (error) throw error;
      return res.status(200).json({ logs: data ?? [] });
    }

    if (req.method === 'POST') {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const date = typeof b.date === 'string' && DATE_RE.test(b.date) ? b.date : null;
      const kg = typeof b.weight_kg === 'number' && Number.isFinite(b.weight_kg) ? b.weight_kg : null;
      if (!date || !notFuture(date) || kg === null || kg < 30 || kg > 300) return invalid(res);

      const { error } = await supabase
        .from('weight_logs')
        .upsert(
          { owner_id: uid, log_date: date, weight_kg: Math.round(kg * 10) / 10 },
          { onConflict: 'owner_id,log_date' },
        );
      if (error) throw error;
      return res.status(200).json({ profile: await syncProfile() });
    }

    if (req.method === 'DELETE') {
      const date = typeof req.query.date === 'string' && DATE_RE.test(req.query.date) ? req.query.date : null;
      if (!date) return invalid(res);
      const { error } = await supabase.from('weight_logs').delete().eq('owner_id', uid).eq('log_date', date);
      if (error) throw error;
      return res.status(200).json({ profile: await syncProfile() });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('weight api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
