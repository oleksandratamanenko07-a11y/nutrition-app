import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n/uk';
import { ApiError, getRecipes, type Recipe } from '../lib/api';
import {
  acceptInvite, activateList, addDish, addItem, cancelInvite, clearBought, createInvite, createList, declineInvite,
  deleteItem, deleteList, getShopHistory, getShopState, leavePair, peekInvite, renameList, restoreItem, setBought,
  updateItem, type ShopState,
} from '../lib/shopping';
import { UNITS, UNIT_LABEL, formatQty, groupHistory, progress, sortItems, timeLeft, type ShopItem, type Unit } from '../lib/shoppingCalc';
import { errorText, parseNum, Sheet } from './ui';

const BOT_URL = 'https://t.me/mykalorii_bot';
const POLL_MS = 3000;

function msgOf(e: unknown): string {
  if (e instanceof ApiError && e.code && t.shop.inviteErrors[e.code]) return t.shop.inviteErrors[e.code];
  if (e instanceof ApiError && e.code === 'conflict') return t.shop.conflict;
  return errorText(e);
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}, ${time}`;
}

export function Shopping() {
  const [st, setSt] = useState<ShopState | null>(null);
  const [listId, setListId] = useState<string | undefined>();
  const [err, setErr] = useState('');
  const [sheet, setSheet] = useState<null | 'lists' | 'pair' | 'history' | 'dish' | 'clear' | { item: ShopItem | null }>(null);
  const sigRef = useRef('');
  const listRef = useRef<string | undefined>(undefined);
  const busy = useRef(false);
  const again = useRef(false);

  const load = useCallback(async (force = false) => {
    if (busy.current) {
      if (force) again.current = true;
      return;
    }
    busy.current = true;
    try {
      const r = await getShopState(listRef.current, force ? undefined : sigRef.current || undefined);
      if (r.changed) {
        sigRef.current = r.sig;
        setSt(r);
      }
      setErr('');
    } catch (e) {
      setErr(errorText(e));
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void load(true);
      }
    }
  }, []);

  // Майже реальний час: коли екран видно, раз на кілька секунд питаємо сервер «щось змінилось?»
  useEffect(() => {
    void load(true);
    const tick = () => {
      if (!document.hidden) void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    const vis = () => {
      if (!document.hidden) void load(true);
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [load]);

  function select(id: string) {
    listRef.current = id;
    sigRef.current = '';
    setListId(id);
    void load(true);
  }

  /** Виконує дію на сервері й оновлює стан; помилку показує в банері. */
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      setErr('');
      await load(true);
      return true;
    } catch (e) {
      setErr(msgOf(e));
      await load(true);
      return false;
    }
  }

  function toggle(it: ShopItem) {
    const next = !it.bought;
    const me = st?.me.id ?? null;
    // Одразу показуємо результат, а сервер підтвердить
    setSt((s) =>
      s ? { ...s, items: s.items.map((x) => (x.id === it.id ? { ...x, bought: next, bought_by: next ? me : null, bought_at: next ? new Date().toISOString() : null } : x)) } : s,
    );
    void run(() => setBought(it.id, next));
  }

  if (!st) {
    return (
      <div className="center-block">
        {err ? (
          <div className="banner">
            <span>{err}</span>
            <button type="button" onClick={() => void load(true)}>{t.retry}</button>
          </div>
        ) : (
          <div className="spinner" aria-label={t.loading} />
        )}
      </div>
    );
  }

  const names: Record<number, string> = { [st.me.id]: t.shop.you };
  if (st.pair?.partner) names[st.pair.partner.id] = st.pair.partner.name;
  const who = (id: number | null) => (id !== null && names[id]) || '—';

  const items = sortItems(st.items);
  const pr = progress(items);
  const subtitle = st.pair ? (st.pair.partner ? t.shop.withPair(st.pair.partner.name) : t.shop.pairAlone) : t.shop.solo;

  return (
    <div className="shop">
      <div className="shop-head">
        <button type="button" className="shop-title" onClick={() => setSheet('lists')}>
          <b>{st.list?.name ?? t.shop.title}</b> <span aria-hidden="true">▾</span>
          <small>{subtitle}</small>
        </button>
        <button type="button" className={`pair-btn ${st.pair ? 'on' : ''}`} onClick={() => setSheet('pair')}>
          👥 {t.shop.pair}
        </button>
      </div>

      {err && (
        <div className="banner">
          <span>{err}</span>
          <button type="button" onClick={() => void load(true)}>{t.retry}</button>
        </div>
      )}

      <div className="shop-progress" aria-label={t.shop.progress(pr.bought, pr.total)}>
        <div className="shop-bar"><div style={{ width: `${pr.pct}%` }} /></div>
        <span>{t.shop.progress(pr.bought, pr.total)}</span>
      </div>

      <div className="chips">
        <button type="button" onClick={() => setSheet('dish')}>{t.shop.fromDish}</button>
        <button type="button" onClick={() => setSheet('history')}>{t.shop.history}</button>
        <button type="button" disabled={pr.bought === 0} onClick={() => setSheet('clear')}>{t.shop.clear}</button>
      </div>

      {items.length === 0 && <p className="muted center-text">{t.shop.empty}</p>}

      <div className="shop-list">
        {items.map((it) => (
          <div className={`shop-item ${it.bought ? 'done' : ''}`} key={it.id}>
            <button type="button" className="shop-check" aria-label={it.name} aria-pressed={it.bought} onClick={() => toggle(it)}>
              {it.bought ? '✓' : ''}
            </button>
            <button type="button" className="shop-body" onClick={() => setSheet({ item: it })}>
              <span className="shop-name">{it.name}</span>
              {it.qty !== null && <span className="shop-qty">{formatQty(it.qty, it.unit)}</span>}
              {it.comment && <span className="shop-sub">{it.comment}</span>}
              {it.bought && <span className="shop-sub">{t.shop.boughtBy(who(it.bought_by), fmtWhen(it.bought_at))}</span>}
              {!it.bought && st.pair && it.added_by !== null && it.added_by !== st.me.id && (
                <span className="shop-sub">{t.shop.addedBy(who(it.added_by))}</span>
              )}
            </button>
          </div>
        ))}
      </div>

      <div className="shop-bottom">
        <button type="button" className="primary" onClick={() => setSheet({ item: null })}>{t.shop.add}</button>
      </div>

      {sheet && typeof sheet === 'object' && (
        <ItemSheet
          item={sheet.item}
          serverError={err}
          onClose={() => setSheet(null)}
          onSave={async (f, more) => {
            const ok = sheet.item
              ? await run(() => updateItem(sheet.item!.id, sheet.item!.version, f))
              : await run(() => addItem(st.list!.id, f));
            // Не вдалося редагування (напр. товар змінив партнер) — закриваємо, щоб було видно банер і свіжі дані
            if ((ok && !more) || (!ok && sheet.item)) setSheet(null);
            return ok;
          }}
          onDelete={async () => {
            if (await run(() => deleteItem(sheet.item!.id))) setSheet(null);
          }}
        />
      )}

      {sheet === 'lists' && (
        <ListsSheet
          st={st}
          onClose={() => setSheet(null)}
          onSelect={(id) => {
            select(id);
            setSheet(null);
          }}
          run={run}
          onSelectNew={select}
        />
      )}

      {sheet === 'clear' && (
        <Sheet title={t.shop.clear} onClose={() => setSheet(null)}>
          <p className="muted">{t.shop.clearNote}</p>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              if (await run(() => clearBought(st.list!.id))) setSheet(null);
            }}
          >
            {t.shop.clearConfirm(pr.bought)}
          </button>
          <button type="button" className="secondary wide" onClick={() => setSheet(null)}>{t.shop.close}</button>
        </Sheet>
      )}

      {sheet === 'history' && st.list && (
        <HistorySheet
          listId={st.list.id}
          version={st.list.version}
          onClose={() => setSheet(null)}
          onRestore={(id) => run(() => restoreItem(id))}
        />
      )}

      {sheet === 'dish' && st.list && (
        <DishSheet
          onClose={() => setSheet(null)}
          onAdd={(rid, times) => run(() => addDish(st.list!.id, rid, times))}
          listId={st.list.id}
        />
      )}

      {sheet === 'pair' && <PairSheet st={st} onClose={() => setSheet(null)} run={run} />}
    </div>
  );
}

// ---------- Товар ----------

function ItemSheet({
  item, serverError, onClose, onSave, onDelete,
}: {
  item: ShopItem | null;
  serverError: string;
  onClose: () => void;
  onSave: (f: { name: string; qty: number | null; unit: Unit | null; comment: string | null }, more: boolean) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [qty, setQty] = useState(item?.qty != null ? String(item.qty).replace('.', ',') : '');
  const [unit, setUnit] = useState<Unit>(item?.unit ?? 'pcs');
  const [comment, setComment] = useState(item?.comment ?? '');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => nameRef.current?.focus(), []);

  async function save(more: boolean) {
    const n = name.trim();
    if (!n) return setError(t.errors.invalid);
    const q = qty.trim() === '' ? null : parseNum(qty);
    if (qty.trim() !== '' && (q === null || q <= 0 || q > 100000)) return setError(t.errors.invalid);
    setBusy(true);
    const ok = await onSave({ name: n, qty: q, unit: q === null ? null : unit, comment: comment.trim() || null }, more);
    setBusy(false);
    if (ok && more) {
      setName(''); setQty(''); setComment(''); setError('');
      nameRef.current?.focus();
    }
  }

  return (
    <Sheet title={item ? t.shop.editItem : t.shop.newItem} onClose={onClose}>
      <label className="field">
        <span>{t.shop.itemName}</span>
        <input ref={nameRef} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>{t.shop.qty}</span>
          <input inputMode="decimal" value={qty} placeholder={t.shop.noUnit} onChange={(e) => setQty(e.target.value)} />
        </label>
        <div className="field">
          <span>{t.shop.unit}</span>
          <div className="segmented unit-seg">
            {UNITS.map((u) => (
              <button key={u} type="button" className={unit === u ? 'active' : ''} onClick={() => setUnit(u)}>{UNIT_LABEL[u]}</button>
            ))}
          </div>
        </div>
      </div>
      <label className="field">
        <span>{t.shop.comment}</span>
        <input value={comment} maxLength={200} placeholder={t.shop.commentHint} onChange={(e) => setComment(e.target.value)} />
      </label>
      {(error || serverError) && <p className="error">{error || serverError}</p>}
      <button type="button" className="primary" disabled={busy} onClick={() => void save(false)}>
        {item ? t.shop.save : t.shop.add.replace('+ ', '')}
      </button>
      {!item && (
        <button type="button" className="secondary wide" disabled={busy} onClick={() => void save(true)}>{t.shop.addMore}</button>
      )}
      {item && (
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={async () => {
            if (!confirm) return setConfirm(true);
            setBusy(true);
            await onDelete();
            setBusy(false);
          }}
        >
          {confirm ? t.shop.confirmDelete : t.shop.delete}
        </button>
      )}
    </Sheet>
  );
}

// ---------- Списки ----------

function ListsSheet({
  st, onClose, onSelect, onSelectNew, run,
}: {
  st: ShopState;
  onClose: () => void;
  onSelect: (id: string) => void;
  onSelectNew: (id: string) => void;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [newName, setNewName] = useState('');
  const [rename, setRename] = useState(st.list?.name ?? '');
  const [confirm, setConfirm] = useState(false);
  const cur = st.list;

  return (
    <Sheet title={t.shop.lists} onClose={onClose}>
      {st.lists.map((l) => (
        <button type="button" key={l.id} className={`row list-row ${cur?.id === l.id ? 'sel' : ''}`} onClick={() => onSelect(l.id)}>
          <span>{l.name} {l.is_active && <em className="badge">{t.shop.activeList}</em>}</span>
          <span className="muted">{t.shop.progress(l.bought, l.total)}</span>
        </button>
      ))}

      <h3 className="subhead">{t.shop.newList}</h3>
      <div className="inline-form">
        <input value={newName} maxLength={60} placeholder={t.shop.listName} onChange={(e) => setNewName(e.target.value)} />
        <button
          type="button"
          className="secondary"
          disabled={!newName.trim()}
          onClick={async () => {
            const n = newName.trim();
            let id = '';
            const ok = await run(async () => {
              id = (await createList(n)).id;
            });
            if (ok && id) onSelectNew(id);
            if (ok) onClose();
          }}
        >
          {t.shop.create}
        </button>
      </div>

      {cur && (
        <>
          <h3 className="subhead">{cur.name}</h3>
          <div className="inline-form">
            <input value={rename} maxLength={60} onChange={(e) => setRename(e.target.value)} />
            <button type="button" className="secondary" disabled={!rename.trim() || rename.trim() === cur.name} onClick={() => void run(() => renameList(cur.id, rename.trim()))}>
              {t.shop.rename}
            </button>
          </div>
          {!cur.is_active && (
            <button type="button" className="secondary wide" onClick={() => void run(() => activateList(cur.id))}>{t.shop.makeActive}</button>
          )}
          {st.lists.length > 1 ? (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (!confirm) return setConfirm(true);
                if (await run(() => deleteList(cur.id))) onClose();
              }}
            >
              {confirm ? t.shop.confirmDelete : t.shop.deleteList}
            </button>
          ) : (
            <p className="muted small">{t.shop.lastList}</p>
          )}
        </>
      )}
    </Sheet>
  );
}

// ---------- Історія ----------

function HistorySheet({
  listId, version, onClose, onRestore,
}: {
  listId: string;
  version: number;
  onClose: () => void;
  onRestore: (id: string) => Promise<boolean>;
}) {
  const [data, setData] = useState<ShopItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getShopHistory(listId)
      .then((r) => alive && setData(r.items))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [listId, version]);

  const groups = data ? groupHistory(data) : [];
  return (
    <Sheet title={t.shop.history} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {!data && !error && <div className="spinner" aria-label={t.loading} />}
      {data && groups.length === 0 && <p className="muted">{t.shop.historyEmpty}</p>}
      {groups.map((g) => (
        <div key={g.day}>
          <h3 className="subhead">{new Date(g.day).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</h3>
          {g.items.map((i) => (
            <div className="row" key={i.id}>
              <span>{i.name} <span className="muted">{formatQty(i.qty, i.unit)}</span></span>
              <button type="button" className="secondary" style={{ flex: 'none', padding: '8px 12px' }} onClick={() => void onRestore(i.id)}>
                {t.shop.restore}
              </button>
            </div>
          ))}
        </div>
      ))}
    </Sheet>
  );
}

// ---------- Інгредієнти зі страви ----------

function DishSheet({
  onClose, onAdd,
}: {
  listId: string;
  onClose: () => void;
  onAdd: (recipeId: string, times: number) => Promise<boolean>;
}) {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [error, setError] = useState('');
  const [times, setTimes] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRecipes().then(setRecipes).catch((e) => setError(errorText(e)));
  }, []);

  return (
    <Sheet title={t.shop.dishPick} onClose={onClose}>
      <label className="field">
        <span>{t.shop.dishTimes}</span>
        <select value={times} onChange={(e) => setTimes(Number(e.target.value))}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>×{n}</option>)}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {!recipes && !error && <div className="spinner" aria-label={t.loading} />}
      {recipes && recipes.length === 0 && <p className="muted">{t.shop.dishNone}</p>}
      {recipes?.map((r) => (
        <button
          type="button"
          key={r.id}
          className="row list-row"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await onAdd(r.id, times);
            setBusy(false);
            if (ok) onClose();
          }}
        >
          <span>{r.name}</span>
          <span className="muted">{r.ingredients.length}</span>
        </button>
      ))}
    </Sheet>
  );
}

// ---------- Пара ----------

function PairSheet({
  st, onClose, run,
}: {
  st: ShopState;
  onClose: () => void;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [code, setCode] = useState('');
  const [peek, setPeek] = useState<{ code: string; from: string } | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 20000);
    return () => window.clearInterval(id);
  }, []);

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(msgOf(e));
    } finally {
      setBusy(false);
    }
  }

  const left = st.invite ? timeLeft(st.invite.expires_at, now) : null;

  if (st.pair) {
    return (
      <Sheet title={t.shop.pairTitle} onClose={onClose}>
        <p className="muted">{t.shop.pairMembers}</p>
        <div className="card"><b>{t.shop.you}: {st.me.name}</b><br />{st.pair.partner ? st.pair.partner.name : '—'}</div>
        <p className="muted small">{t.shop.pairLeaveNote}</p>
        {error && <p className="error">{error}</p>}
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() =>
            guard(async () => {
              if (!confirm) return setConfirm(true);
              await leavePair();
              await run(async () => undefined);
              onClose();
            })
          }
        >
          {confirm ? t.shop.pairLeaveConfirm : t.shop.pairLeave}
        </button>
      </Sheet>
    );
  }

  const shareText = st.invite ? t.shop.pairShareText(st.invite.code) : '';

  return (
    <Sheet title={t.shop.pairTitle} onClose={onClose}>
      <p className="muted">{t.shop.pairIntro}</p>

      {peek ? (
        <div className="card">
          <p><b>{t.shop.pairInvited(peek.from)}</b></p>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              guard(async () => {
                await acceptInvite(peek.code);
                await run(async () => undefined);
                onClose();
              })
            }
          >
            {t.shop.pairAccept}
          </button>
          <button
            type="button"
            className="secondary wide"
            disabled={busy}
            onClick={() =>
              guard(async () => {
                await declineInvite(peek.code);
                setPeek(null);
                setCode('');
                setInfo(t.shop.pairDeclined);
              })
            }
          >
            {t.shop.pairDecline}
          </button>
        </div>
      ) : (
        <>
          {st.invite && left ? (
            <div className="card">
              <span className="muted small">{t.shop.pairCode}</span>
              <div className="invite-code">{st.invite.code}</div>
              <span className="muted small">{t.shop.pairCodeLeft(left)}</span>
              <button
                type="button"
                className="secondary wide"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(st.invite!.code);
                    setInfo(t.shop.pairCopied);
                  } catch {
                    setInfo(st.invite!.code);
                  }
                }}
              >
                {t.shop.pairCopy}
              </button>
              <a className="secondary wide link-btn" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(BOT_URL)}&text=${encodeURIComponent(shareText)}`}>
                {t.shop.pairShare}
              </a>
              <button type="button" className="danger" disabled={busy} onClick={() => guard(async () => { await cancelInvite(); await run(async () => undefined); })}>
                {t.shop.pairCancel}
              </button>
            </div>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={() => guard(async () => { await createInvite(); await run(async () => undefined); })}>
              {t.shop.pairCreate}
            </button>
          )}

          <h3 className="subhead">{t.shop.pairHave}</h3>
          <div className="inline-form">
            <input
              value={code}
              maxLength={12}
              autoCapitalize="characters"
              placeholder={t.shop.pairEnter}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              type="button"
              className="secondary"
              disabled={busy || code.trim().length < 8}
              onClick={() =>
                guard(async () => {
                  const r = await peekInvite(code);
                  setPeek({ code, from: r.from_name });
                })
              }
            >
              {t.shop.pairCheck}
            </button>
          </div>
        </>
      )}
      {info && <p className="muted small">{info}</p>}
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}
