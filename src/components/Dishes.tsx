import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n/uk';
import { CATEGORIES, deleteRecipe, getRecipes, normCategory, saveRecipe, type Category, type Meal, type Recipe } from '../lib/api';
import { fmtKcal } from '../lib/day';
import { photoToDataUrl } from '../lib/image';
import {
  dishPer100,
  dishTotals,
  fmt1,
  NUTRIENTS,
  weightIsPlausible,
  type Ingredient,
  type Nutrient,
} from '../lib/recipe';
import { AddFlow, Thumb } from './AddFlow';
import { DishAddForm } from './DishAdd';
import { SharedDishes } from './SharedDishes';
import { CategoryChips } from './CategoryChips';
import { NoteBlock } from './NoteBlock';
import { errorText, ok, parseNum, Sheet } from './ui';

const NAME: Record<Nutrient, string> = {
  kcal: t.diary.kcal,
  protein: t.diary.protein,
  fat: t.diary.fat,
  carbs: t.diary.carbs,
};
const FIELD = {
  kcal: 'kcal_100',
  protein: 'protein_100',
  fat: 'fat_100',
  carbs: 'carbs_100',
} as const;

const str = (v: number | null) => (v === null ? '' : String(v));

interface Row {
  key: number;
  food_id: string | null;
  name: string;
  grams: string;
  vals: Record<Nutrient, string>;
  /** Клітковина, цукор, сіль інгредієнта — тут не редагуються, але зберігаються */
  extras: Pick<Ingredient, 'fiber_100' | 'sugar_100' | 'salt_100'>;
  open: boolean;
}

let rowKey = 1;
function rowFrom(i: Ingredient): Row {
  return {
    key: rowKey++,
    food_id: i.food_id,
    name: i.name,
    grams: String(i.amount_g),
    vals: {
      kcal: str(i.kcal_100),
      protein: str(i.protein_100),
      fat: str(i.fat_100),
      carbs: str(i.carbs_100),
    },
    extras: { fiber_100: i.fiber_100 ?? null, sugar_100: i.sugar_100 ?? null, salt_100: i.salt_100 ?? null },
    open: false,
  };
}

function ingredientOf(r: Row): { ing: Ingredient; gramsOk: boolean } {
  const v = (n: Nutrient) => {
    const x = parseNum(r.vals[n]);
    const max = n === 'kcal' ? 900 : 100;
    return ok(x, 0, max) ? x : null;
  };
  const g = parseNum(r.grams);
  return {
    gramsOk: ok(g, 0.01, 5000),
    ing: {
      food_id: r.food_id,
      name: r.name,
      amount_g: ok(g, 0.01, 5000) ? g : 0,
      kcal_100: v('kcal'),
      protein_100: v('protein'),
      fat_100: v('fat'),
      carbs_100: v('carbs'),
      ...r.extras,
    },
  };
}

function DishEditor({
  recipe,
  copyOf,
  onClose,
  onSaved,
}: {
  recipe: Recipe | null;
  /** Нова страва-копія: recipe — зразок, copyOf — id публічного оригіналу (або null для власної) */
  copyOf?: { sourceId: string | null; originalNote?: string | null } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(recipe?.name ?? '');
  const [rows, setRows] = useState<Row[]>(recipe ? recipe.ingredients.map(rowFrom) : []);
  const [weight, setWeight] = useState(recipe?.total_weight_g ? String(recipe.total_weight_g) : '');
  const [image, setImage] = useState<string | null>(recipe?.image_data ?? null);
  const [imageChanged, setImageChanged] = useState(false);
  const isCopy = !!copyOf;
  const [isPublic, setIsPublic] = useState(isCopy ? false : recipe ? recipe.is_public !== false : true); // нові страви публічні за замовчуванням
  // Власний коментар: у копії чужої страви починається порожнім (коментар оригіналу показується окремо, лише для читання)
  const [note, setNote] = useState(copyOf?.sourceId ? '' : recipe?.note ?? '');
  const [category, setCategory] = useState<Category | ''>(normCategory(recipe?.category) ?? '');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const parsed = rows.map(ingredientOf);
  const ings = parsed.map((p) => p.ing);
  const w = weight.trim() === '' ? null : parseNum(weight);
  const weightOk = weight.trim() === '' || ok(w, 1, 20000);
  const tot = dishTotals(ings, weightOk ? w : null);
  const per100 = dishPer100(tot);
  const plausible = weightIsPlausible(tot);
  const allGrams = parsed.every((p) => p.gramsOk);
  const canSave =
    name.trim() !== '' && rows.length > 0 && allGrams && weightOk && tot.missing.length === 0 && plausible;

  function setRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setImage(await photoToDataUrl(file));
      setImageChanged(true);
      setError('');
    } catch {
      setError(t.dishes.photoError);
    }
  }

  async function save() {
    setTouched(true);
    if (!canSave || saving) return;
    setSaving(true);
    setError('');
    try {
      await saveRecipe({
        id: isCopy ? undefined : recipe?.id,
        ...(isCopy ? { source_id: copyOf?.sourceId ?? null } : {}),
        name: name.trim(),
        ...(imageChanged || !recipe || isCopy ? { image_data: image } : {}),
        total_weight_g: w,
        is_public: isPublic,
        category: category || null,
        note: note.trim() === '' ? null : note.trim(),
        ingredients: ings,
      });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <>
      <Sheet title={isCopy ? t.dishes.copyTitle : recipe ? t.dishes.editTitle : t.dishes.createTitle} onClose={onClose}>
        {isCopy && <p className="muted small">{t.dishes.copyHint}</p>}
        <label className="field">
          <span>{t.dishes.name}</span>
          <input
            value={name}
            maxLength={80}
            placeholder={t.dishes.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="field">
          <span>{t.dishes.photo}</span>
          <div className="photo-row">
            <Thumb url={image} />
            <label className="secondary file-btn">
              {image ? t.dishes.changePhoto : t.dishes.addPhoto}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void pickPhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {image && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setImage(null);
                  setImageChanged(true);
                }}
              >
                {t.dishes.removePhoto}
              </button>
            )}
          </div>
        </div>

        <label className="field">
          <span>{t.dishes.category}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
            <option value="">{t.dishes.noCategory}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t.dishes.cat[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="check">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          <span>
            {t.dishes.publicLabel}
            <span className="muted small"> {isPublic ? t.dishes.publicHint : t.dishes.privateHint}</span>
          </span>
        </label>

        {copyOf?.originalNote && (
          <>
            <NoteBlock title={t.dishes.originalNote} text={copyOf.originalNote} />
            <p className="muted small">{t.dishes.originalNoteHint}</p>
          </>
        )}
        <label className="field">
          <span>{t.dishes.note}</span>
          <textarea
            rows={3}
            maxLength={500}
            value={note}
            placeholder={t.dishes.notePlaceholder}
            onChange={(e) => setNote(e.target.value)}
          />
          <span className="muted small">{t.dishes.noteCount.replace('{n}', String(note.length))}</span>
        </label>

        <h3 className="subhead">{t.dishes.ingredients}</h3>
        {rows.length === 0 && <p className="muted small">{t.dishes.noIngredients}</p>}

        {rows.map((r, idx) => {
          const missing = NUTRIENTS.filter((n) => parseNum(r.vals[n]) === null);
          return (
            <div className="ing" key={r.key}>
              <div className="ing-head">
                <span className="ing-name">{r.name}</span>
                <button
                  type="button"
                  className="icon small-icon"
                  aria-label={t.diary.remove}
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                >
                  ✕
                </button>
              </div>
              <div className="inline">
                <input
                  inputMode="decimal"
                  aria-label={t.dishes.grams}
                  className={!parsed[idx].gramsOk ? 'missing-input' : ''}
                  value={r.grams}
                  onChange={(e) => setRow(r.key, { grams: e.target.value })}
                />
                <span className="unit">{t.dishes.grams}</span>
                <button type="button" className="secondary" onClick={() => setRow(r.key, { open: !r.open })}>
                  {r.open ? t.dishes.hideValues : t.dishes.editValues}
                </button>
              </div>
              {missing.length > 0 && (
                <p className="missing small">
                  {missing.map((n) => NAME[n]).join(', ')}: {t.dishes.missing}
                </p>
              )}
              {r.open && (
                <div className="grid2" style={{ marginTop: 8 }}>
                  {NUTRIENTS.map((n) => (
                    <label className="field" key={n}>
                      <span>{NAME[n]}</span>
                      <input
                        inputMode="decimal"
                        className={parseNum(r.vals[n]) === null ? 'missing-input' : ''}
                        value={r.vals[n]}
                        onChange={(e) => setRow(r.key, { vals: { ...r.vals, [n]: e.target.value } })}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <button type="button" className="add" onClick={() => setAdding(true)}>
          + {t.dishes.addIngredient}
        </button>

        <label className="field" style={{ marginTop: 14 }}>
          <span>{t.dishes.weightLabel}</span>
          <input
            inputMode="decimal"
            value={weight}
            className={!weightOk ? 'missing-input' : ''}
            placeholder={fmt1(dishTotals(ings).weight)}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <p className="muted small">{t.dishes.weightHint.replace('{w}', fmt1(dishTotals(ings).weight))}</p>

        {rows.length > 0 && (
          <div className="preview">
            <div>
              {t.dishes.totalWeight}: <b>{fmt1(tot.weight)} г</b>
            </div>
            <div>
              {t.dishes.totalNutrition}: <b>{fmtKcal(tot.kcal)} {t.home.kcal}</b> · {t.diary.p} {fmt1(tot.protein)} ·{' '}
              {t.diary.f} {fmt1(tot.fat)} · {t.diary.c} {fmt1(tot.carbs)}
            </div>
            {per100 && (
              <div className="muted">
                {t.dishes.per100}: {fmtKcal(per100.kcal)} {t.home.kcal} · {t.diary.p} {fmt1(per100.protein)} ·{' '}
                {t.diary.f} {fmt1(per100.fat)} · {t.diary.c} {fmt1(per100.carbs)}
              </div>
            )}
          </div>
        )}
        {tot.missing.length > 0 && (
          <p className="error small">
            {t.dishes.missingWarn.replace('{list}', tot.missing.map((n) => NAME[n]).join(', '))}
          </p>
        )}
        {!plausible && <p className="error small">{t.dishes.weightBad}</p>}
        {touched && !canSave && <p className="error small">{t.dishes.fixInput}</p>}
        {error && <p className="error">{error}</p>}

        <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
          {saving ? t.dishes.saving : t.dishes.save}
        </button>
      </Sheet>

      {adding && (
        <AddFlow
          meal="snack"
          date=""
          onClose={() => setAdding(false)}
          onSaved={async () => undefined}
          onIngredient={(i) => {
            setRows((rs) => [...rs, rowFrom(i)]);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

function DishDetail({
  recipe,
  today,
  onClose,
  onEdit,
  onCopy,
  onChanged,
  onAdded,
}: {
  recipe: Recipe;
  today: string;
  onClose: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onChanged: () => Promise<void>;
  onAdded: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tot = dishTotals(recipe.ingredients, recipe.total_weight_g);

  async function remove() {
    if (busy) return;
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    try {
      await deleteRecipe(recipe.id);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <Sheet title={recipe.name} onClose={onClose} onBack={() => setAdding(false)}>
        <DishAddForm
          recipe={recipe}
          meal={defaultMeal()}
          date={today}
          onSaved={async () => {
            await onAdded();
            onClose();
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title={recipe.name} onClose={onClose}>
      {recipe.image_data && <img className="dish-photo" src={recipe.image_data} alt="" />}
      <p className="preview">
        {fmt1(tot.weight)} г · <b>{fmtKcal(tot.kcal)} {t.home.kcal}</b> · {t.diary.p} {fmt1(tot.protein)} · {t.diary.f}{' '}
        {fmt1(tot.fat)} · {t.diary.c} {fmt1(tot.carbs)}
      </p>

      <NoteBlock title={t.dishes.authorNote} text={recipe.note} />
      <NoteBlock title={t.dishes.originalNote} text={recipe.source_note} />

      <h3 className="subhead">{t.dishes.composition}</h3>
      {recipe.ingredients.map((i, idx) => (
        <div className="row" key={idx}>
          <span>{i.name}</span>
          <b>{fmt1(i.amount_g)} г</b>
        </div>
      ))}

      {error && <p className="error">{error}</p>}
      <button type="button" className="primary" style={{ marginTop: 14 }} onClick={() => setAdding(true)}>
        {t.dishes.addToDiary}
      </button>
      <button type="button" className="secondary wide" onClick={onEdit}>
        {t.dishes.edit}
      </button>
      <button type="button" className="secondary wide" onClick={onCopy}>
        {t.dishes.copyEdit}
      </button>
      <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
        {confirm ? t.dishes.confirmDelete : t.dishes.delete}
      </button>
      <p className="muted small">{t.dishes.deleteNote}</p>
    </Sheet>
  );
}

/** Приймання їжі за замовчуванням — за часом доби. */
function defaultMeal(): Meal {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

export function Dishes({ today, onAdded }: { today: string; onAdded: () => Promise<void> }) {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'mine' | 'shared'>('mine');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [view, setView] = useState<
    { k: 'none' } | { k: 'detail'; r: Recipe } | { k: 'edit'; r: Recipe | null; copy?: { sourceId: string | null; originalNote?: string | null } }
  >({ k: 'none' });

  const load = useCallback(async () => {
    try {
      setRecipes(await getRecipes());
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Пошук за всіма словами (без урахування регістру) і фільтр за категорією
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (recipes ?? []).filter((r) => {
    const c = normCategory(r.category);
    if (cat === 'none' ? c !== null : cat !== '' && c !== cat) return false;
    const name = r.name.toLowerCase();
    return words.every((w) => name.includes(w));
  });

  return (
    <>
      <h1>{t.dishes.title}</h1>

      <div className="segmented" style={{ marginBottom: 10 }}>
        <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
          {t.dishes.mine}
        </button>
        <button type="button" className={tab === 'shared' ? 'active' : ''} onClick={() => setTab('shared')}>
          {t.dishes.shared}
        </button>
      </div>
      {tab === 'shared' && (
        <SharedDishes
          onCopyEdit={(r) => setView({ k: 'edit', r, copy: { sourceId: r.id, originalNote: r.note ?? null } })}
          onAdded={async () => {
            setTab('mine');
            await load();
          }}
        />
      )}
      {tab === 'mine' && <>

      <button type="button" className="primary" style={{ margin: '8px 0 12px' }} onClick={() => setView({ k: 'edit', r: null })}>
        + {t.dishes.create}
      </button>

      {error && (
        <div className="banner">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            {t.retry}
          </button>
        </div>
      )}
      {recipes === null && !error && (
        <div className="center-block">
          <div className="spinner" aria-label={t.loading} />
        </div>
      )}
      {recipes && recipes.length === 0 && <p className="muted">{t.dishes.empty}</p>}
      {recipes && recipes.length > 0 && (
        <>
          <label className="field">
            <input type="search" value={q} maxLength={60} placeholder={t.dishes.search} onChange={(e) => setQ(e.target.value)} />
          </label>
          <CategoryChips value={cat} onChange={setCat} />
          {shown.length === 0 && <p className="muted">{t.dishes.sharedNone}</p>}
        </>
      )}

      {shown.map((r) => {
        const tot = dishTotals(r.ingredients, r.total_weight_g);
        return (
          <button type="button" className="card dish-card" key={r.id} onClick={() => setView({ k: 'detail', r })}>
            <Thumb url={r.image_data} />
            <span className="entry-main">
              <span className="entry-name">
                {r.name}
                <span className="badge">{r.is_public === false ? t.dishes.badgePrivate : t.dishes.badgePublic}</span>
              </span>
              <span className="muted small">
                {fmt1(tot.weight)} г · {t.diary.p} {fmt1(tot.protein)} · {t.diary.f} {fmt1(tot.fat)} · {t.diary.c}{' '}
                {fmt1(tot.carbs)}
              </span>
            </span>
            <span className="entry-kcal">{fmtKcal(tot.kcal)}</span>
          </button>
        );
      })}

      </>}

      {view.k === 'detail' && (
        <DishDetail
          recipe={view.r}
          today={today}
          onClose={() => setView({ k: 'none' })}
          onEdit={() => setView({ k: 'edit', r: view.r })}
          onCopy={() => setView({ k: 'edit', r: { ...view.r, name: `${view.r.name} (копія)` }, copy: { sourceId: null } })}
          onChanged={async () => {
            setView({ k: 'none' });
            await load();
          }}
          onAdded={onAdded}
        />
      )}
      {view.k === 'edit' && (
        <DishEditor
          recipe={view.r}
          copyOf={view.copy ?? null}
          onClose={() => setView({ k: 'none' })}
          onSaved={async () => {
            setView({ k: 'none' });
            await load();
          }}
        />
      )}
    </>
  );
}
