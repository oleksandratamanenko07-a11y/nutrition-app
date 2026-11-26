import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';

/**
 * GET /api/history?month=РРРР-ММ  або  ?from=РРРР-ММ-ДД&to=РРРР-ММ-ДД (до 93 днів)
 * Записи щоденника за місяць і вся історія денних цілей користувача.
 * Підсумки рахує клієнт тими самими функціями, що й головна, — окремої системи підрахунку немає.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let first: string;
  let last: string;
  const month = typeof req.query.month === 'string' ? req.query.month : '';
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'invalid_data' });
    const [y, m] = month.split('-').map(Number);
    first = `${month}-01`;
    last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  } else {
    // довільний інтервал (статистика): не більше 93 днів
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
    const span = ok ? (Date.parse(to) - Date.parse(from)) / 86400000 : 0;
    if (!ok || Number.isNaN(span) || span > 92) return res.status(400).json({ error: 'invalid_data' });
    first = from;
    last = to;
  }

  try {
    const supabase = db();
    const [entries, goals] = await Promise.all([
      supabase
        .from('diary_entries')
        .select('*')
        .eq('owner_id', user.id)
        .gte('entry_date', first)
        .lte('entry_date', last)
        .order('created_at', { ascending: true })
        .limit(5000),
      supabase
        .from('goal_history')
        .select('effective_from,kcal_goal,protein_goal_g,fat_goal_g,carbs_goal_g')
        .eq('owner_id', user.id)
        .order('effective_from', { ascending: true })
        .limit(2000),
    ]);
    if (entries.error) throw entries.error;
    if (goals.error) throw goals.error;
    return res.status(200).json({ entries: entries.data ?? [], goals: goals.data ?? [] });
  } catch (e) {
    console.error('history api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
