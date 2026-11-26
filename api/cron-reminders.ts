import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_lib/supabase.js';
import {
  addDaysStr,
  confirmReminders,
  dueByTime,
  DORMANT_DAYS,
  MESSAGES,
  WEIGHT_RECENT_DAYS,
  type Due,
} from './_lib/reminders.js';

interface Row {
  telegram_id: number;
  tz: string | null;
  remind_diary: boolean;
  remind_weight: boolean;
  last_diary_reminder: string | null;
  last_weight_reminder: string | null;
}

type SendResult = 'sent' | 'blocked' | 'rate_limited' | 'error';

async function send(token: string, chatId: number, text: string): Promise<SendResult> {
  const appUrl = process.env.APP_URL?.replace(/\/$/, '');
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(appUrl && appUrl.startsWith('https://')
          ? { reply_markup: { inline_keyboard: [[{ text: 'Відкрити застосунок', web_app: { url: appUrl } }]] } }
          : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) return 'sent';
    if (r.status === 429) return 'rate_limited';
    // 403: користувач заблокував бота або не починав з ним діалог; 400 «chat not found» — те саме
    if (r.status === 403 || r.status === 400) return 'blocked';
    return 'error';
  } catch {
    return 'error';
  }
}

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * GET /api/cron-reminders — викликається щогодини з GitHub Actions (заголовок Authorization: Bearer CRON_SECRET).
 * Надсилає нагадування про щоденник (після 19:00, якщо немає записів) і про вагу (неділя зранку).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.CRON_SECRET || !process.env.TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ error: 'not_configured' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const supabase = db();
    const token = process.env.TELEGRAM_BOT_TOKEN as string;
    const now = new Date();

    const { data, error } = await supabase
      .from('profiles')
      .select('telegram_id,tz,remind_diary,remind_weight,last_diary_reminder,last_weight_reminder')
      .eq('onboarded', true)
      .not('tz', 'is', null)
      .or('remind_diary.eq.true,remind_weight.eq.true')
      .limit(5000);
    if (error) throw error;

    const candidates: { row: Row; due: Due }[] = [];
    for (const row of (data ?? []) as Row[]) {
      const due = dueByTime({
        now,
        tz: row.tz,
        diaryOn: row.remind_diary,
        weightOn: row.remind_weight,
        lastDiary: row.last_diary_reminder,
        lastWeight: row.last_weight_reminder,
      });
      if (due) candidates.push({ row, due });
    }

    const stats = { checked: (data ?? []).length, due: candidates.length, sent: 0, blocked: 0, failed: 0 };
    let stop = false;

    async function handleOne({ row, due }: { row: Row; due: Due }) {
      if (stop) return;
      const uid = row.telegram_id;
      const since = addDaysStr(due.date, -DORMANT_DAYS);
      const weightSince = addDaysStr(due.date, -WEIGHT_RECENT_DAYS);

      const [today, recent, weight] = await Promise.all([
        due.diary
          ? supabase.from('diary_entries').select('id', { count: 'exact', head: true }).eq('owner_id', uid).eq('entry_date', due.date)
          : Promise.resolve({ count: 0, error: null }),
        due.diary
          ? supabase.from('logged_days').select('day', { count: 'exact', head: true }).eq('owner_id', uid).gte('day', since)
          : Promise.resolve({ count: 0, error: null }),
        due.weight
          ? supabase.from('weight_logs').select('log_date', { count: 'exact', head: true }).eq('owner_id', uid).gte('log_date', weightSince)
          : Promise.resolve({ count: 0, error: null }),
      ]);
      if (today.error || recent.error || weight.error) {
        stats.failed++;
        return;
      }

      const kinds = confirmReminders(due, {
        hasEntryToday: (today.count ?? 0) > 0,
        activeRecently: (recent.count ?? 0) > 0,
        weightRecent: (weight.count ?? 0) > 0,
      });

      for (const kind of kinds) {
        if (stop) return;
        const result = await send(token, uid, MESSAGES[kind]);
        if (result === 'sent') {
          stats.sent++;
          const { error: markError } = await supabase
            .from('profiles')
            .update(kind === 'diary' ? { last_diary_reminder: due.date } : { last_weight_reminder: due.date })
            .eq('telegram_id', uid);
          if (markError) console.error('reminder mark error', markError);
        } else if (result === 'blocked') {
          // бот не може писати цьому користувачу — вимикаємо нагадування (користувач може ввімкнути знову в профілі)
          stats.blocked++;
          await supabase.from('profiles').update({ remind_diary: false, remind_weight: false }).eq('telegram_id', uid);
          return;
        } else if (result === 'rate_limited') {
          stop = true;
          stats.failed++;
        } else {
          stats.failed++;
        }
      }
    }

    for (let i = 0; i < candidates.length && !stop; i += 10) {
      await Promise.all(candidates.slice(i, i + 10).map(handleOne));
    }

    return res.status(200).json({ ok: true, ...stats });
  } catch (e) {
    console.error('cron reminders error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
