import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';

/** GET /api/days — усі дні, у які користувач вів щоденник (для медалей і серій). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const { data, error } = await db()
      .from('logged_days')
      .select('day')
      .eq('owner_id', user.id)
      .order('day', { ascending: true })
      .limit(5000);
    if (error) throw error;
    return res.status(200).json({ days: (data ?? []).map((r: { day: string }) => r.day) });
  } catch (e) {
    console.error('days api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
