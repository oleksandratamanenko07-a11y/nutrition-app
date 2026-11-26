import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n/uk';
import { copyShared, getShared, type SharedRecipe } from '../lib/api';
import { fmtKcal } from '../lib/day';
import { dishPer100, dishTotals, fmt1 } from '../lib/recipe';
import { Thumb } from './AddFlow';
import { CategoryChips } from './CategoryChips';
import { NoteBlock } from './NoteBlock';
import { errorText, Sheet } from './ui';

function SharedDetail({
  recipe,
  onClose,
  onCopyEdit,
  onAdded,
}: {
  recipe: SharedRecipe;
  onClose: () => void;
  onCopyEdit: (r: SharedRecipe) => void;
  onAdded: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function addToMine() {
    if (busy) return; // захист від повторних натискань
    setBusy(true);
    setError('');
    try {
      const r = await copyShared(recipe.id);
      setNote(r.already ? t.dishes.alreadyMine : t.dishes.addedToMine);
      await onAdded();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  const tot = dishTotals(recipe.ingredients, recipe.total_weight_g);
  const per100 = dishPer100(tot);
  return (
    <Sheet title={recipe.name} onClose={onClose}>
      {recipe.image_data && <img className="dish-photo" src={recipe.image_data} alt="" />}
      {recipe.category && <p className="muted small">{t.dishes.cat[recipe.category]}</p>}
      <div className="preview">
        <div>
          {t.dishes.totalNutrition}: <b>{fmtKcal(tot.kcal)} {t.home.kcal}</b> · {t.diary.p} {fmt1(tot.protein)} ·{' '}
          {t.diary.f} {fmt1(tot.fat)} · {t.diary.c} {fmt1(tot.carbs)}
        </div>
        <div className="muted">
          {t.dishes.totalWeight}: {fmt1(tot.weight)} г
        </div>
        {per100 && (
          <div className="muted">
            {t.dishes.per100}: {fmtKcal(per100.kcal)} {t.home.kcal} · {t.diary.p} {fmt1(per100.protein)} · {t.diary.f}{' '}
            {fmt1(per100.fat)} · {t.diary.c} {fmt1(per100.carbs)}
          </div>
        )}
      </div>
      {tot.missing.length > 0 && <p className="error small">{t.dishes.incomplete}</p>}

      <NoteBlock title={t.dishes.authorNote} text={recipe.note} />

      <h3 className="subhead">{t.dishes.composition}</h3>
      {recipe.ingredients.map((i, idx) => (
        <div className="row" key={idx}>
          <span>{i.name}</span>
          <b>{fmt1(i.amount_g)} г</b>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      {note && <p className="muted small">{note}</p>}
      <button type="button" className="primary" style={{ marginTop: 14 }} disabled={busy} onClick={() => void addToMine()}>
        {t.dishes.addToMine}
      </button>
      <button type="button" className="secondary wide" disabled={busy} onClick={() => onCopyEdit(recipe)}>
        {t.dishes.copyEdit}
      </button>
      <p className="muted small">{t.dishes.sharedNote}</p>
    </Sheet>
  );
}

/** Загальна бібліотека: страви інших користувачів (лише перегляд і пошук; автор анонімний) */
export function SharedDishes({
  onCopyEdit,
  onAdded,
}: {
  onCopyEdit: (r: SharedRecipe) => void;
  onAdded: () => Promise<void>;
}) {
  const [items, setItems] = useState<SharedRecipe[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<SharedRecipe | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (query: string, category: string) => {
    const my = ++seq.current;
    try {
      const r = await getShared(query, 0, category);
      if (my !== seq.current) return; // застарілу відповідь ігноруємо
      setItems(r.items);
      setHasMore(r.has_more);
      setError('');
    } catch (e) {
      if (my === seq.current) setError(errorText(e));
    }
  }, []);

  // Пошук із невеликою затримкою, щоб не слати запит на кожну літеру
  useEffect(() => {
    const id = setTimeout(() => void load(q, cat), q ? 350 : 0);
    return () => clearTimeout(id);
  }, [q, cat, load]);

  async function more() {
    if (!items || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await getShared(q, items.length, cat);
      setItems((cur) => {
        const have = new Set((cur ?? []).map((x) => x.id));
        return [...(cur ?? []), ...r.items.filter((x) => !have.has(x.id))];
      });
      setHasMore(r.has_more);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <label className="field">
        <input type="search" value={q} maxLength={60} placeholder={t.dishes.search} onChange={(e) => setQ(e.target.value)} />
      </label>
      <CategoryChips value={cat} onChange={setCat} />

      {error && (
        <div className="banner">
          <span>{error}</span>
          <button type="button" onClick={() => void load(q, cat)}>
            {t.retry}
          </button>
        </div>
      )}
      {items === null && !error && (
        <div className="center-block">
          <div className="spinner" aria-label={t.loading} />
        </div>
      )}
      {items && items.length === 0 && <p className="muted">{q.trim() || cat ? t.dishes.sharedNone : t.dishes.sharedEmpty}</p>}

      {items?.map((r) => {
        const tot = dishTotals(r.ingredients, r.total_weight_g);
        return (
          <button type="button" className="card dish-card" key={r.id} onClick={() => setOpen(r)}>
            <Thumb url={r.image_data} />
            <span className="entry-main">
              <span className="entry-name">{r.name}</span>
              <span className="muted small">
                {fmt1(tot.weight)} г · {t.diary.p} {fmt1(tot.protein)} · {t.diary.f} {fmt1(tot.fat)} · {t.diary.c}{' '}
                {fmt1(tot.carbs)}
              </span>
            </span>
            <span className="entry-kcal">{fmtKcal(tot.kcal)}</span>
          </button>
        );
      })}
      {hasMore && (
        <button type="button" className="secondary wide" disabled={loadingMore} onClick={() => void more()}>
          {t.dishes.more}
        </button>
      )}

      {open && (
        <SharedDetail
          recipe={open}
          onClose={() => setOpen(null)}
          onCopyEdit={(r) => {
            setOpen(null);
            onCopyEdit(r);
          }}
          onAdded={onAdded}
        />
      )}
    </>
  );
}
