import crypto from 'node:crypto';
import type { VercelRequest } from '@vercel/node';

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Перевірка підпису Telegram initData за офіційним алгоритмом:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Повертає користувача, якщо підпис вірний і дані свіжі, інакше null.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 24 * 60 * 60,
): TgUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(calculated, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as TgUser;
    return typeof user.id === 'number' ? user : null;
  } catch {
    return null;
  }
}

/** Достає користувача із заголовка Authorization: tma <initData> */
export function getUser(req: VercelRequest): TgUser | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('tma ')) return null;
  return verifyInitData(header.slice(4), token);
}
