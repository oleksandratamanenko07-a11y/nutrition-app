import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/uk';
import {
  addEntry,
  getRecipes,
  lookupBarcode,
  recentFoods,
  searchFoods,
  type Food,
  type Meal,
  type Recipe,
} from '../lib/api';
import type { Ingredient } from '../lib/recipe';
import { DishAddForm } from './DishAdd';
import { portion } from '../lib/calc';
import { fmtG, fmtKcal } from '../lib/day';
import { errorText, MealPicker, ok, parseNum, Sheet } from './ui';
import { Scanner } from './Scanner';

type Nutrient = 'kcal' | 'protein' | 'fat' | 'carbs';
const NUTRIENTS: Nutrient[] = ['kcal', 'protein', 'fat', 'carbs'];
const LABEL: Record<Nutrient, string> = {
  kcal: t.diary.kcal,
  protein: t.diary.protein,
  fat: t.diary.fat,
  carbs: t.diary.carbs,
};

export interface Draft {
  foodId: string | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  country: string | null;
  image_url: string | null;
  source: 'manual' | 'openfoodfacts';
  values: Record<Nutrient, string>;
  /** Поля, яких немає в базі продуктів — показуємо «не вказано», нічого не підставляємо */
  missing: Record<Nutrient, boolean>;
  fromKj: boolean;
  suspicious: boolean;
}

export function emptyDraft(barcode: string | null = null): Draft {
  return {
    foodId: null,
    barcode,
    name: '',
    brand: null,
    country: null,
    image_url: null,
    source: 'manual',
    values: { kcal: '', protein: '', fat: '', carbs: '' },
    missing: { kcal: false, protein: false, fat: false, carbs: false },
    fromKj: false,
    suspicious: false,
  };
}

export function draftFromFood(f: Food): Draft {
  const v = {
    kcal: f.kcal_100,
    protein: f.protein_100,
    fat: f.fat_100,
    carbs: f.carbs_100,
  };
  const str = (n: number | null) => (n === null ? '' : String(n));
  return {
    foodId: f.id,
    barcode: f.barcode,
    name: f.name,
    brand: f.brand,
    country: f.country,
    image_url: f.image_url,
    source: f.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
    values: { kcal: str(v.kcal), protein: str(v.protein), fat: str(v.fat), carbs: str(v.carbs) },
    missing: {
      kcal: v.kcal === null,
      protein: v.protein === null,
      fat: v.fat === null,
      carbs: v.carbs === null,
    },
    fromKj: f.kcal_from_kj,
    suspicious: f.suspicious,
  };
}

type Step =
  | { k: 'menu' }
  | { k: 'scan' }
  | { k: 'lookup'; code: string }
  | { k: 'missing'; code: string; unavailable: boolean }
  | { k: 'search' }
  | { k: 'dishes'; recipes: Recipe[] | null; failed: boolean }
  | { k: 'dish'; recipe: Recipe }
  | { k: 'form'; draft: Draft; back: 'menu' | 'search' };

function Spinner() {
  return (
    <div className="center-block">
      <div className="spinner" aria-label={t.loading} />
    </div>
  );
}

export function Thumb({ url }: { url: string | null }) {
  return url ? (
    <img className="thumb" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <span className="thumb placeholder" aria-hidden="true">
      🍽
    </span>
  );
}

function FoodRow({ food, onPick }: { food: Food; onPick: () => void }) {
  const kcal = food.kcal_100 === null ? t.scan.notSpecified : `${fmtKcal(food.kcal_100)} ${t.home.kcal}`;
  return (
    <button type="button" className="entry food-row" onClick={onPick}>
      <Thumb url={food.image_url} />
      <span className="entry-main">
        <span className="entry-name">{food.name}</span>
        <span className="muted small">
          {[food.brand, kcal + ' / 100 г'].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  );
}

function ProductForm({
  draft: initial,
  meal: initialMeal,
  date,
  onSaved,
  onIngredient,
}: {
  draft: Draft;
  meal: Meal;
  date: string;
  onSaved: () => Promise<void>;
  /** Якщо передано — форма додає інгредієнт до страви, а не запис у щоденник */
  onIngredient?: (i: Ingredient) => void;
}) {
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [name, setName] = useState(initial.name);
  const [values, setValues] = useState(initial.values);
  const [grams, setGrams] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const n = {
    kcal: parseNum(values.kcal),
    protein: parseNum(values.protein),
    fat: parseNum(values.fat),
    carbs: parseNum(values.carbs),
  };
  const g = parseNum(grams);
  const valid =
    name.trim() !== '' && ok(n.kcal, 0, 900) && ok(n.protein, 0, 100) && ok(n.fat, 0, 100) &&
    ok(n.carbs, 0, 100) && ok(g, 0.01, 5000);
  const sumTooBig = ok(n.protein, 0, 100) && ok(n.fat, 0, 100) && ok(n.carbs, 0, 100) &&
    n.protein + n.fat + n.carbs > 105;
  const preview =
    valid && !sumTooBig
      ? portion({ kcal: n.kcal!, protein: n.protein!, fat: n.fat!, carbs: n.carbs! }, g!)
      : null;

  async function submit() {
    setTouched(true);
    if (!valid || sumTooBig || saving) return;
    if (onIngredient) {
      onIngredient({
        food_id: initial.foodId,
        name: name.trim(),
        amount_g: g!,
        kcal_100: n.kcal!,
        protein_100: n.protein!,
        fat_100: n.fat!,
        carbs_100: n.carbs!,
      });
      return;
    }
    setSaving(true);
    setError('');
    try {
      await addEntry({
        date,
        meal,
        name: name.trim(),
        amount_g: g!,
        kcal_100: n.kcal!,
        protein_100: n.protein!,
        fat_100: n.fat!,
        carbs_100: n.carbs!,
        barcode: initial.barcode,
        brand: initial.brand,
        country: initial.country,
        image_url: initial.image_url,
        source: initial.source,
      });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <>
      <div className="product-card">
        <Thumb url={initial.image_url} />
        <div className="product-meta">
          <div className="muted small">
            {[initial.brand, initial.country].filter(Boolean).join(' · ') || ' '}
          </div>
          {initial.barcode && (
            <div className="muted small">
              {t.scan.barcode}: {initial.barcode}
            </div>
          )}
        </div>
      </div>

      <label className="field">
        <span>{t.diary.name}</span>
        <input
          value={name}
          maxLength={120}
          placeholder={t.diary.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <p className="muted small">
        {t.diary.per100}. {initial.source === 'openfoodfacts' ? t.scan.sourceOff : t.diary.per100Hint}
      </p>
      <div className="grid2">
        {NUTRIENTS.map((k) => {
          const empty = values[k].trim() === '';
          const flagged = initial.missing[k] && empty;
          return (
            <label className="field" key={k}>
              <span>
                {LABEL[k]}
                {flagged && <b className="missing"> · {t.scan.notSpecified}</b>}
              </span>
              <input
                inputMode="decimal"
                className={flagged ? 'missing-input' : ''}
                value={values[k]}
                placeholder={initial.missing[k] ? '—' : ''}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              />
            </label>
          );
        })}
      </div>
      {NUTRIENTS.some((k) => initial.missing[k] && values[k].trim() === '') && (
        <p className="error small">{t.scan.missingHint}</p>
      )}
      {initial.fromKj && <p className="muted small">{t.scan.fromKj}</p>}
      {initial.suspicious && <p className="error small">{t.scan.suspicious}</p>}

      <label className="field">
        <span>{t.diary.grams}</span>
        <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
      </label>

      {!onIngredient && (
        <label className="field">
          <span>{t.diary.meal}</span>
          <MealPicker value={meal} onChange={setMeal} />
        </label>
      )}

      {preview && (
        <p className="preview">
          {t.diary.total}: <b>{fmtKcal(preview.kcal)} {t.home.kcal}</b> · {t.diary.p} {fmtG(preview.protein)} ·{' '}
          {t.diary.f} {fmtG(preview.fat)} · {t.diary.c} {fmtG(preview.carbs)}
        </p>
      )}
      {sumTooBig && <p className="error">{t.diary.macroSum}</p>}
      {touched && !valid && <p className="error">{t.diary.fillAll}</p>}
      {error && <p className="error">{error}</p>}

      <button type="button" className="primary" disabled={saving} onClick={() => void submit()}>
        {saving ? t.diary.saving : onIngredient ? t.dishes.addToDish : t.diary.addButton}
      </button>
    </>
  );
}

function SearchStep({ onPick, onManual }: { onPick: (f: Food) => void; onManual: () => void }) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ saved: Food[]; off: Food[]; off_error: boolean } | null>(null);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    // зайві пробіли на початку, в кінці та між словами не впливають на пошук
    const text = q.replace(/\s+/g, ' ').trim();
    if (text.length < 2) {
      setResult(null);
      setLoading(false);
      setError('');
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await searchFoods(text);
        if (id !== seq.current) return;
        setResult(r);
        setError('');
      } catch (e) {
        if (id !== seq.current) return;
        setError(errorText(e));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [q]);

  const empty = result && result.saved.length === 0 && result.off.length === 0;

  return (
    <>
      <label className="field">
        <input
          autoFocus
          value={q}
          placeholder={t.scan.searchPlaceholder}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {q.trim().length === 1 && <p className="muted small">{t.scan.minChars}</p>}
      {loading && <Spinner />}
      {error && <p className="error">{error}</p>}

      {!loading && result && (
        <>
          {result.off_error && <p className="muted small">{t.scan.offError}</p>}
          {result.saved.length > 0 && (
            <>
              <h3 className="subhead">{t.scan.mySaved}</h3>
              {result.saved.map((f) => (
                <FoodRow key={f.id ?? f.name} food={f} onPick={() => onPick(f)} />
              ))}
            </>
          )}
          {result.off.length > 0 && (
            <>
              <h3 className="subhead">{t.scan.offResults}</h3>
              {result.off.map((f, i) => (
                <FoodRow key={(f.barcode ?? f.name) + i} food={f} onPick={() => onPick(f)} />
              ))}
            </>
          )}
          {empty && <p className="muted">{t.scan.nothing}</p>}
        </>
      )}

      <button type="button" className="add" onClick={onManual}>
        + {t.scan.manualButton}
      </button>
    </>
  );
}

export function AddFlow({
  meal,
  date,
  onClose,
  onSaved,
  onIngredient,
}: {
  meal: Meal;
  date: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  /** Режим «інгредієнт для страви»: замість запису в щоденник повертає інгредієнт */
  onIngredient?: (i: Ingredient) => void;
}) {
  const [step, setStep] = useState<Step>({ k: 'menu' });
  const [recent, setRecent] = useState<Food[]>([]);

  useEffect(() => {
    recentFoods().then(setRecent).catch(() => setRecent([]));
  }, []);

  // Пошук за штрихкодом
  const lookupCode = step.k === 'lookup' ? step.code : null;
  useEffect(() => {
    if (!lookupCode) return;
    let cancelled = false;
    lookupBarcode(lookupCode)
      .then((r) => {
        if (cancelled) return;
        if (r.status === 'found') {
          setStep({ k: 'form', draft: draftFromFood(r.product), back: 'menu' });
        } else {
          setStep({ k: 'missing', code: lookupCode, unavailable: r.status === 'unavailable' });
        }
      })
      .catch(() => {
        if (!cancelled) setStep({ k: 'missing', code: lookupCode, unavailable: true });
      });
    return () => {
      cancelled = true;
    };
  }, [lookupCode]);

  const toMenu = () => setStep({ k: 'menu' });

  const openDishes = () => {
    setStep({ k: 'dishes', recipes: null, failed: false });
    getRecipes()
      .then((recipes) => setStep({ k: 'dishes', recipes, failed: false }))
      .catch(() => setStep({ k: 'dishes', recipes: null, failed: true }));
  };
  const menuTitle = onIngredient ? t.dishes.ingredientTitle : t.scan.menuTitle;

  if (step.k === 'menu') {
    return (
      <Sheet title={menuTitle} onClose={onClose}>
        <button type="button" className="primary" onClick={() => setStep({ k: 'scan' })}>
          📷 {t.scan.scanButton}
        </button>
        <div className="menu-buttons">
          <button type="button" className="secondary" onClick={() => setStep({ k: 'search' })}>
            🔎 {t.scan.searchButton}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setStep({ k: 'form', draft: emptyDraft(), back: 'menu' })}
          >
            ✍️ {t.scan.manualButton}
          </button>
        </div>
        {!onIngredient && (
          <button type="button" className="add" onClick={openDishes}>
            🍲 {t.dishes.menuButton}
          </button>
        )}
        {recent.length > 0 && (
          <>
            <h3 className="subhead">{t.scan.recent}</h3>
            {recent.map((f) => (
              <FoodRow
                key={f.id ?? f.name}
                food={f}
                onPick={() => setStep({ k: 'form', draft: draftFromFood(f), back: 'menu' })}
              />
            ))}
          </>
        )}
      </Sheet>
    );
  }

  if (step.k === 'scan') {
    return (
      <Sheet title={t.scan.title} onClose={onClose} onBack={toMenu}>
        <Scanner onCode={(code) => setStep({ k: 'lookup', code })} />
      </Sheet>
    );
  }

  if (step.k === 'lookup') {
    return (
      <Sheet title={t.scan.title} onClose={onClose} onBack={toMenu}>
        <Spinner />
        <p className="muted center-text">{t.scan.looking}</p>
      </Sheet>
    );
  }

  if (step.k === 'missing') {
    const code = step.code;
    return (
      <Sheet
        title={step.unavailable ? t.scan.unavailableTitle : t.scan.notFoundTitle}
        onClose={onClose}
        onBack={toMenu}
      >
        <p>
          {step.unavailable ? t.scan.unavailableText : t.scan.notFoundText.replace('{code}', code)}
        </p>
        {step.unavailable && (
          <button type="button" className="primary" onClick={() => setStep({ k: 'lookup', code })}>
            {t.retry}
          </button>
        )}
        <div className="menu-buttons">
          <button type="button" className="secondary" onClick={() => setStep({ k: 'search' })}>
            🔎 {t.scan.searchButton}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setStep({ k: 'form', draft: emptyDraft(code), back: 'menu' })}
          >
            ✍️ {t.scan.manualButton}
          </button>
        </div>
        <button type="button" className="add" onClick={() => setStep({ k: 'scan' })}>
          📷 {t.scan.scanAgain}
        </button>
      </Sheet>
    );
  }

  if (step.k === 'search') {
    return (
      <Sheet title={t.scan.searchButton} onClose={onClose} onBack={toMenu}>
        <SearchStep
          onPick={(f) => setStep({ k: 'form', draft: draftFromFood(f), back: 'search' })}
          onManual={() => setStep({ k: 'form', draft: emptyDraft(), back: 'search' })}
        />
      </Sheet>
    );
  }

  if (step.k === 'dishes') {
    return (
      <Sheet title={t.dishes.pickTitle} onClose={onClose} onBack={toMenu}>
        {step.failed && <p className="error">{t.dishes.loadError}</p>}
        {!step.failed && step.recipes === null && <Spinner />}
        {step.recipes && step.recipes.length === 0 && <p className="muted">{t.dishes.empty}</p>}
        {step.recipes?.map((r) => (
          <button type="button" className="entry food-row" key={r.id} onClick={() => setStep({ k: 'dish', recipe: r })}>
            <Thumb url={r.image_data} />
            <span className="entry-main">
              <span className="entry-name">{r.name}</span>
            </span>
          </button>
        ))}
      </Sheet>
    );
  }

  if (step.k === 'dish') {
    return (
      <Sheet title={step.recipe.name} onClose={onClose} onBack={openDishes}>
        <DishAddForm recipe={step.recipe} meal={meal} date={date} onSaved={onSaved} />
      </Sheet>
    );
  }

  return (
    <Sheet
      title={onIngredient ? t.dishes.ingredientTitle : t.diary.addTitle}
      onClose={onClose}
      onBack={() => setStep(step.back === 'search' ? { k: 'search' } : { k: 'menu' })}
    >
      <ProductForm draft={step.draft} meal={meal} date={date} onSaved={onSaved} onIngredient={onIngredient} />
    </Sheet>
  );
}
