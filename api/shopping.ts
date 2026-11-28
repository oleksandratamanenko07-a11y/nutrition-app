import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUser } from './_lib/auth.js';
import { db } from './_lib/supabase.js';
import { INVITE_TTL_MS, cleanItem, newInviteCode, normCode, planMerge, type Unit } from './_lib/shopping.js';

/**
 * Спільні покупки. Один файл — одна функція Vercel (ліміт 12 функцій).
 *
 *   GET  ?a=state[&list=<id>][&sig=<підпис>]  → {changed:false} або повний стан (пара, запрошення, списки, товари)
 *   GET  ?a=history&list=<id>                 → {items} товари з історії покупок
 *   POST {a: ..., ...}                        → дії (див. switch нижче), у відповідь — {ok:true,...}
 *
 * Доступ до даних перевіряється тут, на сервері: список належить або парі (обидва учасники), або одній людині.
 * Таблиці закриті для клієнта (RLS без політик), сервер працює з секретним ключем.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LISTS = 20;
const MAX_ITEMS = 300;
const HISTORY_DAYS = 60;

type Row = Record<string, unknown>;
type Sb = ReturnType<typeof db>;

class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}
const bad = () => new HttpError(400, 'invalid_data');
const notFound = () => new HttpError(404, 'not_found');
const conflict = () => new HttpError(409, 'conflict');
const limit = () => new HttpError(409, 'limit');

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

// ---------- Telegram ----------

async function notify(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const appUrl = process.env.APP_URL?.replace(/\/$/, '');
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(appUrl && appUrl.startsWith('https://')
          ? { reply_markup: { inline_keyboard: [[{ text: 'Відкрити застосунок', web_app: { url: appUrl } }]] } }
          : {}),
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Сповіщення не критичне: якщо не вдалося, дія все одно виконана
  }
}

// ---------- Доступ ----------

async function pairOf(sb: Sb, uid: number): Promise<string | null> {
  const { data, error } = await sb.from('pair_members').select('pair_id').eq('telegram_id', uid).maybeSingle();
  if (error) throw error;
  return data ? (data.pair_id as string) : null;
}

async function partnerOf(sb: Sb, uid: number, pid: string): Promise<number | null> {
  const { data, error } = await sb.from('pair_members').select('telegram_id').eq('pair_id', pid).neq('telegram_id', uid);
  if (error) throw error;
  return data && data[0] ? Number(data[0].telegram_id) : null;
}

async function nameOf(sb: Sb, id: number): Promise<string> {
  const { data } = await sb.from('profiles').select('first_name').eq('telegram_id', id).maybeSingle();
  const n = (data?.first_name as string | null) ?? '';
  return n.trim() || 'Користувач';
}

/** Список, до якого в користувача є доступ, інакше null. */
async function accessibleList(sb: Sb, uid: number, listId: unknown): Promise<Row | null> {
  if (!isUuid(listId)) return null;
  const { data, error } = await sb.from('shopping_lists').select('*').eq('id', listId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.pair_id) {
    const pid = await pairOf(sb, uid);
    return pid && pid === data.pair_id ? data : null;
  }
  return Number(data.owner_id) === uid ? data : null;
}

async function mustList(sb: Sb, uid: number, listId: unknown): Promise<Row> {
  const l = await accessibleList(sb, uid, listId);
  if (!l) throw notFound();
  return l;
}

async function mustItem(sb: Sb, uid: number, itemId: unknown): Promise<{ item: Row; list: Row }> {
  if (!isUuid(itemId)) throw bad();
  const { data, error } = await sb.from('shopping_items').select('*').eq('id', itemId).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound();
  const list = await accessibleList(sb, uid, data.list_id);
  if (!list) throw notFound(); // чужий товар не відрізняємо від неіснуючого
  return { item: data, list };
}

/** Списки поточного «простору»: пара, якщо вона є, інакше особисті. */
async function scopeLists(sb: Sb, uid: number, pid: string | null): Promise<Row[]> {
  const q = sb.from('shopping_lists').select('id,name,is_active,version,pair_id,owner_id,created_at');
  const { data, error } = await (pid ? q.eq('pair_id', pid) : q.eq('owner_id', uid).is('pair_id', null)).order('created_at', {
    ascending: true,
  });
  if (error) throw error;
  return data ?? [];
}

async function createList(sb: Sb, uid: number, pid: string | null, name: string, active: boolean): Promise<Row> {
  const { data, error } = await sb
    .from('shopping_lists')
    .insert({ owner_id: uid, pair_id: pid, name, is_active: active })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Якщо списків ще немає — створює «Покупки» (активний). Гонку двох запитів гасить унікальний індекс. */
async function ensureLists(sb: Sb, uid: number, pid: string | null): Promise<Row[]> {
  let lists = await scopeLists(sb, uid, pid);
  if (lists.length === 0) {
    try {
      await createList(sb, uid, pid, 'Покупки', true);
    } catch {
      /* інший запит уже створив */
    }
    lists = await scopeLists(sb, uid, pid);
  }
  if (lists.length > 0 && !lists.some((l) => l.is_active)) {
    await sb.from('shopping_lists').update({ is_active: true }).eq('id', lists[0].id);
    lists = await scopeLists(sb, uid, pid);
  }
  return lists;
}

async function openInvite(sb: Sb, uid: number): Promise<{ code: string; expires_at: string } | null> {
  const { data, error } = await sb
    .from('pair_invites')
    .select('code,expires_at')
    .eq('from_user', uid)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data[0] ? { code: data[0].code as string, expires_at: data[0].expires_at as string } : null;
}

// ---------- Стан ----------

const ITEM_COLS = 'id,list_id,name,qty,unit,comment,added_by,bought,bought_by,bought_at,cleared_at,version,created_at';

function publicItem(r: Row) {
  return {
    id: r.id,
    name: r.name,
    qty: r.qty === null || r.qty === undefined ? null : Number(r.qty),
    unit: r.unit ?? null,
    comment: r.comment ?? null,
    added_by: r.added_by === null ? null : Number(r.added_by),
    bought: !!r.bought,
    bought_by: r.bought_by === null || r.bought_by === undefined ? null : Number(r.bought_by),
    bought_at: r.bought_at ?? null,
    cleared_at: r.cleared_at ?? null,
    version: Number(r.version),
    created_at: r.created_at,
  };
}

async function buildState(sb: Sb, uid: number, wantList: unknown, clientSig: unknown) {
  const pid = await pairOf(sb, uid);
  const lists = await ensureLists(sb, uid, pid);
  const invite = pid ? null : await openInvite(sb, uid);
  const partnerId = pid ? await partnerOf(sb, uid, pid) : null;

  const selected =
    (isUuid(wantList) ? lists.find((l) => l.id === wantList) : undefined) ?? lists.find((l) => l.is_active) ?? lists[0];

  const sig = crypto
    .createHash('sha1')
    .update(
      [
        pid ?? '-',
        partnerId ?? '-',
        invite?.code ?? '-',
        selected?.id ?? '-',
        ...lists.map((l) => `${l.id}:${l.version}:${l.is_active ? 1 : 0}:${l.name}`),
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 16);

  if (typeof clientSig === 'string' && clientSig === sig) return { changed: false, sig };

  // Кількість товарів у кожному списку (для перемикача списків)
  const ids = lists.map((l) => l.id as string);
  const counts = new Map<string, { total: number; bought: number }>();
  let items: Row[] = [];
  if (ids.length) {
    const { data, error } = await sb.from('shopping_items').select(ITEM_COLS).in('list_id', ids).is('cleared_at', null).limit(MAX_LISTS * MAX_ITEMS);
    if (error) throw error;
    for (const r of data ?? []) {
      const c = counts.get(r.list_id as string) ?? { total: 0, bought: 0 };
      c.total += 1;
      if (r.bought) c.bought += 1;
      counts.set(r.list_id as string, c);
      if (selected && r.list_id === selected.id) items.push(r);
    }
  }

  const people = new Map<number, string>();
  people.set(uid, await nameOf(sb, uid));
  if (partnerId) people.set(partnerId, await nameOf(sb, partnerId));

  return {
    changed: true,
    sig,
    me: { id: uid, name: people.get(uid) },
    pair: pid ? { id: pid, partner: partnerId ? { id: partnerId, name: people.get(partnerId) } : null } : null,
    invite,
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      is_active: !!l.is_active,
      version: Number(l.version),
      total: counts.get(l.id as string)?.total ?? 0,
      bought: counts.get(l.id as string)?.bought ?? 0,
    })),
    list: selected ? { id: selected.id, name: selected.name, version: Number(selected.version), is_active: !!selected.is_active } : null,
    items: items.map(publicItem),
  };
}

// ---------- Дії ----------

const INVITE_ERRORS = new Set(['invite_not_found', 'invite_expired', 'invite_used', 'self_invite', 'already_in_pair', 'inviter_in_pair', 'not_in_pair']);

function inviteError(e: unknown): HttpError | null {
  const msg = String((e as { message?: string })?.message ?? '');
  for (const c of INVITE_ERRORS) if (msg.includes(c)) return new HttpError(422, c);
  return null;
}

function listName(v: unknown): string {
  const n = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (n.length < 1 || n.length > 60) throw bad();
  return n;
}

async function countOpen(sb: Sb, listId: string): Promise<number> {
  const { count, error } = await sb.from('shopping_items').select('id', { count: 'exact', head: true }).eq('list_id', listId).is('cleared_at', null);
  if (error) throw error;
  return count ?? 0;
}

async function act(sb: Sb, uid: number, b: Row): Promise<Row> {
  const a = b.a;
  switch (a) {
    // ----- Запрошення і пара -----
    case 'invite_create': {
      if (await pairOf(sb, uid)) throw new HttpError(422, 'already_in_pair');
      await sb.from('pair_invites').update({ status: 'cancelled' }).eq('from_user', uid).eq('status', 'pending');
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newInviteCode();
        const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
        const { error } = await sb.from('pair_invites').insert({ code, from_user: uid, expires_at: expires });
        if (!error) return { ok: true, code, expires_at: expires };
        if (!String(error.message).includes('duplicate')) throw error;
      }
      throw new Error('code_generation_failed');
    }
    case 'invite_cancel': {
      await sb.from('pair_invites').update({ status: 'cancelled' }).eq('from_user', uid).eq('status', 'pending');
      return { ok: true };
    }
    case 'invite_peek': {
      const code = normCode(b.code);
      if (!code) throw new HttpError(422, 'invite_not_found');
      const { data, error } = await sb.from('pair_invites').select('from_user,status,expires_at').eq('code', code).maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(422, 'invite_not_found');
      if (data.status !== 'pending') throw new HttpError(422, 'invite_used');
      if (new Date(data.expires_at as string).getTime() < Date.now()) throw new HttpError(422, 'invite_expired');
      if (Number(data.from_user) === uid) throw new HttpError(422, 'self_invite');
      if (await pairOf(sb, uid)) throw new HttpError(422, 'already_in_pair');
      if (await pairOf(sb, Number(data.from_user))) throw new HttpError(422, 'inviter_in_pair');
      return { ok: true, from_name: await nameOf(sb, Number(data.from_user)) };
    }
    case 'invite_accept': {
      const code = normCode(b.code);
      if (!code) throw new HttpError(422, 'invite_not_found');
      const { data: inv } = await sb.from('pair_invites').select('from_user').eq('code', code).maybeSingle();
      const { data: pid, error } = await sb.rpc('accept_pair_invite', { p_code: code, p_user: uid });
      if (error) throw inviteError(error) ?? error;
      await ensureLists(sb, uid, pid as string);
      if (inv) {
        const me = await nameOf(sb, uid);
        await notify(Number(inv.from_user), `Запрошення прийнято: ${me} тепер у вашій парі. Спільні списки покупок уже доступні.`);
      }
      return { ok: true };
    }
    case 'invite_decline': {
      const code = normCode(b.code);
      if (!code) throw new HttpError(422, 'invite_not_found');
      const { data: inv } = await sb.from('pair_invites').select('from_user,status').eq('code', code).maybeSingle();
      if (!inv || inv.status !== 'pending' || Number(inv.from_user) === uid) throw new HttpError(422, 'invite_not_found');
      const { error } = await sb.from('pair_invites').update({ status: 'declined', to_user: uid }).eq('code', code).eq('status', 'pending');
      if (error) throw error;
      await notify(Number(inv.from_user), `Запрошення відхилено: ${await nameOf(sb, uid)}.`);
      return { ok: true };
    }
    case 'pair_leave': {
      const { data: partner, error } = await sb.rpc('leave_pair', { p_user: uid });
      if (error) throw inviteError(error) ?? error;
      if (partner) await notify(Number(partner), `${await nameOf(sb, uid)} вийшов(-ла) з пари. Усі ваші списки покупок збережено.`);
      return { ok: true };
    }

    // ----- Списки -----
    case 'list_create': {
      const name = listName(b.name);
      const pid = await pairOf(sb, uid);
      const lists = await ensureLists(sb, uid, pid);
      if (lists.length >= MAX_LISTS) throw limit();
      const l = await createList(sb, uid, pid, name, false);
      return { ok: true, id: l.id };
    }
    case 'list_rename': {
      const l = await mustList(sb, uid, b.id);
      const { error } = await sb.from('shopping_lists').update({ name: listName(b.name), version: Number(l.version) + 1, updated_at: new Date().toISOString() }).eq('id', l.id);
      if (error) throw error;
      return { ok: true };
    }
    case 'list_activate': {
      const l = await mustList(sb, uid, b.id);
      const scope = l.pair_id ? sb.from('shopping_lists').update({ is_active: false }).eq('pair_id', l.pair_id) : sb.from('shopping_lists').update({ is_active: false }).eq('owner_id', l.owner_id).is('pair_id', null);
      const { error: e1 } = await scope.eq('is_active', true).neq('id', l.id);
      if (e1) throw e1;
      const { error: e2 } = await sb.from('shopping_lists').update({ is_active: true }).eq('id', l.id);
      if (e2) throw conflict(); // двоє одночасно зробили активними різні списки — клієнт оновить стан
      return { ok: true };
    }
    case 'list_delete': {
      const l = await mustList(sb, uid, b.id);
      const pid = await pairOf(sb, uid);
      const lists = await scopeLists(sb, uid, pid);
      if (lists.length <= 1) throw limit(); // останній список не видаляємо
      const { error } = await sb.from('shopping_lists').delete().eq('id', l.id);
      if (error) throw error;
      await ensureLists(sb, uid, pid);
      return { ok: true };
    }

    // ----- Товари -----
    case 'item_add': {
      const l = await mustList(sb, uid, b.list_id);
      const it = cleanItem(b);
      if (!it) throw bad();
      if ((await countOpen(sb, l.id as string)) >= MAX_ITEMS) throw limit();
      const { data, error } = await sb.from('shopping_items').insert({ list_id: l.id, ...it, added_by: uid }).select(ITEM_COLS).single();
      if (error) throw error;
      return { ok: true, item: publicItem(data) };
    }
    case 'item_update': {
      const { item } = await mustItem(sb, uid, b.id);
      const it = cleanItem(b);
      const ver = Number(b.version);
      if (!it || !Number.isInteger(ver)) throw bad();
      if (item.cleared_at) throw conflict();
      const { data, error } = await sb
        .from('shopping_items')
        .update({ ...it, version: ver + 1, updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('version', ver)
        .select(ITEM_COLS);
      if (error) throw error;
      if (!data || data.length === 0) throw conflict(); // хтось змінив товар раніше
      return { ok: true, item: publicItem(data[0]) };
    }
    case 'item_bought': {
      const { item } = await mustItem(sb, uid, b.id);
      if (typeof b.bought !== 'boolean') throw bad();
      if (item.cleared_at) throw conflict();
      // Явне значення, а не «перемкнути»: подвійне натискання двох людей не скасовує відмітку
      if (!!item.bought === b.bought) return { ok: true, item: publicItem(item) };
      const patch = b.bought
        ? { bought: true, bought_by: uid, bought_at: new Date().toISOString() }
        : { bought: false, bought_by: null, bought_at: null };
      const { data, error } = await sb
        .from('shopping_items')
        .update({ ...patch, version: Number(item.version) + 1, updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .is('cleared_at', null)
        .select(ITEM_COLS);
      if (error) throw error;
      if (!data || data.length === 0) throw conflict();
      return { ok: true, item: publicItem(data[0]) };
    }
    case 'item_delete': {
      const { item } = await mustItem(sb, uid, b.id);
      const { error } = await sb.from('shopping_items').delete().eq('id', item.id);
      if (error) throw error;
      return { ok: true };
    }
    case 'clear_bought': {
      const l = await mustList(sb, uid, b.list_id);
      const now = new Date().toISOString();
      const { data, error } = await sb
        .from('shopping_items')
        .update({ cleared_at: now })
        .eq('list_id', l.id)
        .eq('bought', true)
        .is('cleared_at', null)
        .select('id');
      if (error) throw error;
      // Історія зберігається обмежений час
      const old = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
      await sb.from('shopping_items').delete().eq('list_id', l.id).lt('cleared_at', old);
      return { ok: true, cleared: data?.length ?? 0 };
    }
    case 'history_restore': {
      const { item } = await mustItem(sb, uid, b.id);
      if (!item.cleared_at) return { ok: true };
      if ((await countOpen(sb, item.list_id as string)) >= MAX_ITEMS) throw limit();
      const { error } = await sb
        .from('shopping_items')
        .update({ cleared_at: null, bought: false, bought_by: null, bought_at: null, version: Number(item.version) + 1, updated_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) throw error;
      return { ok: true };
    }

    // ----- Інгредієнти зі страви -----
    case 'add_dish': {
      const l = await mustList(sb, uid, b.list_id);
      if (!isUuid(b.recipe_id)) throw bad();
      const times = b.times === undefined ? 1 : Number(b.times);
      if (!Number.isInteger(times) || times < 1 || times > 20) throw bad();
      // Тільки власна страва користувача; нічого, крім назв та ваги інгредієнтів, у список не потрапляє
      const { data: rec, error: re } = await sb.from('recipes').select('id').eq('id', b.recipe_id).eq('owner_id', uid).maybeSingle();
      if (re) throw re;
      if (!rec) throw notFound();
      const { data: ings, error: ie } = await sb.from('recipe_ingredients').select('name,amount_g').eq('recipe_id', rec.id);
      if (ie) throw ie;
      const incoming = (ings ?? [])
        .map((i) => ({ name: String(i.name ?? '').trim().slice(0, 80), qty: Math.round(Number(i.amount_g) * times * 1000) / 1000, unit: 'g' as Unit }))
        .filter((i) => i.name && Number.isFinite(i.qty) && i.qty > 0);
      if (incoming.length === 0) throw bad();

      const { data: ex, error: xe } = await sb.from('shopping_items').select('id,name,qty,unit,bought').eq('list_id', l.id).is('cleared_at', null);
      if (xe) throw xe;
      const plan = planMerge(
        (ex ?? []).map((r) => ({ id: r.id as string, name: r.name as string, qty: r.qty === null ? null : Number(r.qty), unit: (r.unit ?? null) as Unit | null, bought: !!r.bought })),
        incoming,
      );
      if ((ex?.length ?? 0) + plan.inserts.length > MAX_ITEMS) throw limit();
      for (const u of plan.updates) {
        const { error } = await sb.from('shopping_items').update({ qty: u.qty, unit: u.unit, updated_at: new Date().toISOString() }).eq('id', u.id);
        if (error) throw error;
      }
      if (plan.inserts.length) {
        const { error } = await sb.from('shopping_items').insert(plan.inserts.map((i) => ({ list_id: l.id, name: i.name, qty: i.qty, unit: i.unit, added_by: uid })));
        if (error) throw error;
      }
      return { ok: true, added: plan.inserts.length, merged: plan.updates.length };
    }
    default:
      throw bad();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  try {
    const sb = db();
    // Власник запису в profiles потрібен для зовнішніх ключів; профіль створюється при вході, але перевіримо
    const { data: me } = await sb.from('profiles').select('telegram_id').eq('telegram_id', user.id).maybeSingle();
    if (!me) return res.status(401).json({ error: 'unauthorized' });

    if (req.method === 'GET') {
      const a = String(req.query.a ?? 'state');
      if (a === 'state') return res.status(200).json(await buildState(sb, user.id, req.query.list, req.query.sig));
      if (a === 'history') {
        const l = await mustList(sb, user.id, req.query.list);
        const { data, error } = await sb
          .from('shopping_items')
          .select(ITEM_COLS)
          .eq('list_id', l.id)
          .not('cleared_at', 'is', null)
          .order('cleared_at', { ascending: false })
          .limit(300);
        if (error) throw error;
        const ids = new Set<number>();
        (data ?? []).forEach((r) => r.bought_by && ids.add(Number(r.bought_by)));
        const people: Record<string, string> = {};
        for (const id of ids) people[String(id)] = await nameOf(sb, id);
        return res.status(200).json({ items: (data ?? []).map(publicItem), people });
      }
      return res.status(400).json({ error: 'invalid_data' });
    }

    const body = (req.body ?? {}) as Row;
    const out = await act(sb, user.id, body);
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.code });
    console.error('shopping api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
