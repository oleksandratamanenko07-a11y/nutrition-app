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
import { buildAdvice, type AdviceEntry } from './_lib/advice.js';
import { analyze, reviewMessage, reviewWindow, type ReviewEntry, type ReviewGoal } from './_lib/review.js';

interface Row {
  telegram_id: number;
  tz: string | null;
  remind_diary: boolean;
  remind_weight: boolean;
  remind_review: boolean;
  last_diary_reminder: string | null;
  last_weight_reminder: string | null;
  last_review_date: string | null;
  last_review_check: string | null;
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
      .select('telegram_id,tz,remind_diary,remind_weight,remind_review,last_diary_reminder,last_weight_reminder,last_review_date,last_review_check')
      .eq('onboarded', true)
      .not('tz', 'is', null)
      .or('remind_diary.eq.true,remind_weight.eq.true,remind_review.eq.true')
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
        reviewOn: row.remind_review,
        lastReview: row.last_review_date,
        lastReviewCheck: row.last_review_check,
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

      const blockAll = () =>
        supabase
          .from('profiles')
          .update({ remind_diary: false, remind_weight: false, remind_review: false })
          .eq('telegram_id', uid);

      // Аналітика за 3 повні дні: раз на 3 дні вранці, якщо є записи щонайменше за 2 дні
      if (due.review) {
        const window = reviewWindow(due.date);
        const [entries, goals] = await Promise.all([
          supabase
            .from('diary_entries')
            .select('entry_date,meal,name,amount_g,kcal_100,protein_100,fat_100,carbs_100,sugar_100')
            .eq('owner_id', uid)
            // 14 днів: аналіз іде по 3 днях, а власні білкові продукти для порад беруться з довшої історії
            .gte('entry_date', addDaysStr(window[0], -11))
            .lte('entry_date', window[window.length - 1])
            .limit(3000),
          supabase
            .from('goal_history')
            .select('effective_from,kcal_goal,protein_goal_g,fat_goal_g,carbs_goal_g')
            .eq('owner_id', uid)
            .order('effective_from', { ascending: true })
            .limit(2000),
        ]);
        if (entries.error || goals.error) {
          stats.failed++;
        } else {
          const review = analyze((entries.data ?? []) as ReviewEntry[], (goals.data ?? []) as ReviewGoal[], window);
          let sentReview = false;
          if (review && !stop) {
            let tips: string[] = [];
            try {
              tips = buildAdvice(review, (entries.data ?? []) as AdviceEntry[], window, (goals.data ?? []) as ReviewGoal[]);
            } catch (e) {
              console.error('advice error', e); // поради не критичні: без них повідомлення все одно піде
            }
            const result = await send(token, uid, reviewMessage(review, tips));
            if (result === 'sent') {
              stats.sent++;
              sentReview = true;
            } else if (result === 'blocked') {
              stats.blocked++;
              await blockAll();
              return;
            } else if (result === 'rate_limited') {
              stop = true;
              stats.failed++;
            } else {
              stats.failed++;
            }
          }
          // Дані є, але повідомлення не пішло через збій — не позначаємо день, спробуємо наступної години
          if (sentReview || !review) {
            const { error: markError } = await supabase
              .from('profiles')
              .update(sentReview ? { last_review_date: due.date, last_review_check: due.date } : { last_review_check: due.date })
              .eq('telegram_id', uid);
            if (markError) console.error('review mark error', markError);
          }
        }
      }
      if (!due.diary && !due.weight) return;

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
          await blockAll();
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
