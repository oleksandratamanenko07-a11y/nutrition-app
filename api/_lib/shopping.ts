import crypto from 'node:crypto';

// Чиста логіка «Спільних покупок»: перевірка даних, одиниці, об'єднання товарів, коди запрошень.
// Без звернень до бази — щоб її можна було перевірити самотестом.

export const UNITS = ['g', 'kg', 'ml', 'l', 'pcs'] as const;
export type Unit = (typeof UNITS)[number];

export interface ItemInput {
  name: string;
  qty: number | null;
  unit: Unit | null;
  comment: string | null;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Перевіряє поля товару. null — дані некоректні. */
export function cleanItem(b: Record<string, unknown>): ItemInput | null {
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 1 || name.length > 80) return null;

  let qty: number | null = null;
  if (b.qty !== undefined && b.qty !== null && b.qty !== '') {
    const q = Number(b.qty);
    if (!Number.isFinite(q) || q <= 0 || q > 100000) return null;
    qty = r3(q);
    if (qty <= 0) return null;
  }
  let unit: Unit | null = null;
  if (b.unit !== undefined && b.unit !== null && b.unit !== '') {
    if (typeof b.unit !== 'string' || !(UNITS as readonly string[]).includes(b.unit)) return null;
    unit = b.unit as Unit;
  }
  if (unit && qty === null) return null; // одиниця без кількості не має сенсу
  if (qty !== null && unit === null) unit = 'pcs';

  let comment: string | null = null;
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== 'string') return null;
    const c = b.comment.trim();
    if (c.length > 200) return null;
    comment = c || null;
  }
  return { name, qty, unit, comment };
}

export type Dim = 'mass' | 'vol' | 'pcs';

/** Переводить кількість в базову одиницю: г, мл або шт. */
export function toBase(qty: number, unit: Unit): { dim: Dim; amount: number } {
  switch (unit) {
    case 'g': return { dim: 'mass', amount: r3(qty) };
    case 'kg': return { dim: 'mass', amount: r3(qty * 1000) };
    case 'ml': return { dim: 'vol', amount: r3(qty) };
    case 'l': return { dim: 'vol', amount: r3(qty * 1000) };
    default: return { dim: 'pcs', amount: r3(qty) };
  }
}

/** З базової одиниці — у зручну: від 1000 г це кг, від 1000 мл це л. */
export function fromBase(dim: Dim, amount: number): { qty: number; unit: Unit } {
  if (dim === 'mass') return amount >= 1000 ? { qty: r3(amount / 1000), unit: 'kg' } : { qty: r3(amount), unit: 'g' };
  if (dim === 'vol') return amount >= 1000 ? { qty: r3(amount / 1000), unit: 'l' } : { qty: r3(amount), unit: 'ml' };
  return { qty: r3(amount), unit: 'pcs' };
}

/** Ключ порівняння назв: без регістру й зайвих пробілів («й» та «и» не змішуються). */
export const nameKey = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export interface ExistingItem {
  id: string;
  name: string;
  qty: number | null;
  unit: Unit | null;
  bought: boolean;
}
export interface Incoming {
  name: string;
  qty: number;
  unit: Unit;
}
export interface MergePlan {
  updates: { id: string; qty: number; unit: Unit }[];
  inserts: { name: string; qty: number; unit: Unit }[];
}

/**
 * Додає інгредієнти до списку. Однакові продукти (однакова назва і однакова «вимірність»: вага, об'єм, штуки)
 * складаються в одну позицію. Куплені товари не чіпаємо — те, що вже куплено, треба купувати ще раз.
 */
export function planMerge(existing: ExistingItem[], incoming: Incoming[]): MergePlan {
  type Slot = { id: string | null; name: string; dim: Dim; amount: number; touched: boolean };
  const slots = new Map<string, Slot>();
  const k = (name: string, dim: Dim) => `${nameKey(name)}|${dim}`;

  for (const e of existing) {
    if (e.bought || e.qty === null || e.unit === null) continue;
    const b = toBase(e.qty, e.unit);
    const key = k(e.name, b.dim);
    if (!slots.has(key)) slots.set(key, { id: e.id, name: e.name, dim: b.dim, amount: b.amount, touched: false });
  }
  for (const i of incoming) {
    const b = toBase(i.qty, i.unit);
    const key = k(i.name, b.dim);
    const s = slots.get(key);
    if (s) {
      s.amount = r3(s.amount + b.amount);
      s.touched = true;
    } else {
      slots.set(key, { id: null, name: i.name, dim: b.dim, amount: b.amount, touched: true });
    }
  }
  const plan: MergePlan = { updates: [], inserts: [] };
  for (const s of slots.values()) {
    if (!s.touched) continue;
    const { qty, unit } = fromBase(s.dim, s.amount);
    if (s.id) plan.updates.push({ id: s.id, qty, unit });
    else plan.inserts.push({ name: s.name, qty, unit });
  }
  return plan;
}

// Без схожих символів (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newInviteCode(len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

/** Нормалізує введений код: великі літери, без пробілів і дефісів. null — формат неправильний. */
export function normCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z2-9]{8}$/.test(c) && ![...c].some((ch) => !ALPHABET.includes(ch)) ? c : null;
}

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
