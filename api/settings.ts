import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';
import { validTz } from './_lib/reminders.js';

/**
 * Налаштування нагадувань і часовий пояс.
 *   PUT {remind_diary?: boolean, remind_weight?: boolean, tz?: string}  → {profile}
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (b.remind_diary !== undefined) {
      if (typeof b.remind_diary !== 'boolean') return res.status(400).json({ error: 'invalid_data' });
      patch.remind_diary = b.remind_diary;
    }
    if (b.remind_weight !== undefined) {
      if (typeof b.remind_weight !== 'boolean') return res.status(400).json({ error: 'invalid_data' });
      patch.remind_weight = b.remind_weight;
    }
    if (b.tz !== undefined) {
      if (!validTz(b.tz)) return res.status(400).json({ error: 'invalid_data' });
      patch.tz = b.tz;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'invalid_data' });

    const { data, error } = await db()
      .from('profiles')
      .update(patch)
      .eq('telegram_id', user.id)
      .select('*')
      .single();
    if (error) throw error;
    return res.status(200).json({ profile: data });
  } catch (e) {
    console.error('settings api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
