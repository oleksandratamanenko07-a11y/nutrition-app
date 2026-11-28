import { request } from './api';
import type { ShopItem, Unit } from './shoppingCalc';

export interface ListInfo {
  id: string;
  name: string;
  is_active: boolean;
  version: number;
  total: number;
  bought: number;
}
export interface Person {
  id: number;
  name: string;
}
export interface ShopState {
  changed: true;
  sig: string;
  me: Person;
  pair: { id: string; partner: Person | null } | null;
  invite: { code: string; expires_at: string } | null;
  lists: ListInfo[];
  list: { id: string; name: string; version: number; is_active: boolean } | null;
  items: ShopItem[];
}
export type ShopPoll = ShopState | { changed: false; sig: string };

export interface ItemFields {
  name: string;
  qty: number | null;
  unit: Unit | null;
  comment: string | null;
}

const post = <T>(body: Record<string, unknown>) => request<T>('/api/shopping', { method: 'POST', body: JSON.stringify(body) });

/** Стан екрана. Якщо передати sig і нічого не змінилось, сервер відповість {changed:false}. */
export function getShopState(list?: string, sig?: string): Promise<ShopPoll> {
  const q = new URLSearchParams({ a: 'state' });
  if (list) q.set('list', list);
  if (sig) q.set('sig', sig);
  return request<ShopPoll>(`/api/shopping?${q}`);
}

export function getShopHistory(list: string) {
  return request<{ items: ShopItem[]; people: Record<string, string> }>(`/api/shopping?a=history&list=${encodeURIComponent(list)}`);
}

export const createInvite = () => post<{ code: string; expires_at: string }>({ a: 'invite_create' });
export const cancelInvite = () => post<{ ok: true }>({ a: 'invite_cancel' });
export const peekInvite = (code: string) => post<{ from_name: string }>({ a: 'invite_peek', code });
export const acceptInvite = (code: string) => post<{ ok: true }>({ a: 'invite_accept', code });
export const declineInvite = (code: string) => post<{ ok: true }>({ a: 'invite_decline', code });
export const leavePair = () => post<{ ok: true }>({ a: 'pair_leave' });

export const createList = (name: string) => post<{ id: string }>({ a: 'list_create', name });
export const renameList = (id: string, name: string) => post<{ ok: true }>({ a: 'list_rename', id, name });
export const activateList = (id: string) => post<{ ok: true }>({ a: 'list_activate', id });
export const deleteList = (id: string) => post<{ ok: true }>({ a: 'list_delete', id });

export const addItem = (list_id: string, f: ItemFields) => post<{ item: ShopItem }>({ a: 'item_add', list_id, ...f });
export const updateItem = (id: string, version: number, f: ItemFields) => post<{ item: ShopItem }>({ a: 'item_update', id, version, ...f });
export const setBought = (id: string, bought: boolean) => post<{ item: ShopItem }>({ a: 'item_bought', id, bought });
export const deleteItem = (id: string) => post<{ ok: true }>({ a: 'item_delete', id });
export const clearBought = (list_id: string) => post<{ cleared: number }>({ a: 'clear_bought', list_id });
export const restoreItem = (id: string) => post<{ ok: true }>({ a: 'history_restore', id });
export const addDish = (list_id: string, recipe_id: string, times: number) =>
  post<{ added: number; merged: number }>({ a: 'add_dish', list_id, recipe_id, times });
