import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/uk';
import {
  addEntry,
  applyTemplate,
  deleteTemplate,
  frequentFoods,
  getRecipes,
  getTemplates,
  lookupBarcode,
  recentFoods,
  searchFoods,
  type SearchResult,
  type Food,
  type FrequentFood,
  type Meal,
  type MealTemplate,
  type Recipe,
} from '../lib/api';
import type { Ingredient } from '../lib/recipe';
import { DishAddForm } from './DishAdd';
import { portion, sum } from '../lib/calc';
import { fmtG, fmtKcal } from '../lib/day';
import { formatCount, gramsFromPortions, portionCountFor, stepCount } from '../lib/portion';
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
  source: 'manual' | 'openfoodfacts' | 'usda';
  values: Record<Nutrient, string>;
  /** Клітковина, цукор, сіль на 100 г; порожній рядок — «не вказано» */
  extras: { fiber: string; sugar: string; salt: string };
  /** Порція продукту: назва і вага в грамах (порожній рядок — не задано) */
  portion: { name: string; grams: string };
  /** Поля, яких немає в базі продуктів — показуємо «не вказано», нічого не підставляємо */
  missing: Record<Nutrient, boolean>;
  fromKj: boolean;
  suspicious: boolean;
  /** Кількість, підставлена у форму (наприклад, остання використана) */
  amount?: string;
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
    extras: { fiber: '', sugar: '', salt: '' },
    portion: { name: '', grams: '' },
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
    source: f.source === 'openfoodfacts' ? 'openfoodfacts' : f.source === 'usda' ? 'usda' : 'manual',
    values: { kcal: str(v.kcal), protein: str(v.protein), fat: str(v.fat), carbs: str(v.carbs) },
    extras: { fiber: str(f.fiber_100 ?? null), sugar: str(f.sugar_100 ?? null), salt: str(f.salt_100 ?? null) },
    portion: { name: f.portion_name ?? '', grams: str(f.portion_g ?? null) },
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
  | { k: 'combos' }
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
  const [extras, setExtras] = useState(initial.extras);
  const [pdef, setPdef] = useState(initial.portion);
  // Порція: якщо задана, кількість можна вводити порціями (1; 1,5; 2…) замість грамів
  const initPg = parseNum(initial.portion.grams);
  const initHasPortion = ok(initPg, 0.01, 5000);
  const initAmount = initial.amount ? parseNum(initial.amount) : null;
  const initCount = initHasPortion && initAmount !== null ? portionCountFor(initAmount, initPg!) : null;
  const [unit, setUnit] = useState<'g' | 'portion'>(
    initHasPortion && (initAmount === null || initCount !== null) ? 'portion' : 'g',
  );
  const [count, setCount] = useState(initCount !== null ? formatCount(initCount) : '1');
  const [grams, setGrams] = useState(initial.amount ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const n = {
    kcal: parseNum(values.kcal),
    protein: parseNum(values.protein),
    fat: parseNum(values.fat),
    carbs: parseNum(values.carbs),
  };
  // Вага порції: порожньо — не задано; некоректне значення — undefined
  const pgNum = (() => {
    if (pdef.grams.trim() === '') return null;
    const x = parseNum(pdef.grams);
    return ok(x, 0.01, 5000) ? x : undefined;
  })();
  const portionValid = pgNum !== undefined;
  const hasPortion = typeof pgNum === 'number';
  const portionWord = pdef.name.trim() || t.portion.default;
  const byPortion = hasPortion && unit === 'portion';
  const cnt = parseNum(count);
  const g = byPortion ? (ok(cnt, 0.01, 1000) ? gramsFromPortions(cnt!, pgNum!) : null) : parseNum(grams);
  // клітковина, цукор, сіль: порожнє поле = «не вказано» (null), а не нуль
  const extraNum = (s: string): number | null | undefined => {
    if (s.trim() === '') return null;
    const x = parseNum(s);
    return ok(x, 0, 100) ? x : undefined; // undefined — некоректне значення
  };
  const ex = { fiber: extraNum(extras.fiber), sugar: extraNum(extras.sugar), salt: extraNum(extras.salt) };
  const extrasValid = ex.fiber !== undefined && ex.sugar !== undefined && ex.salt !== undefined;
  const valid =
    extrasValid && portionValid && name.trim() !== '' && ok(n.kcal, 0, 900) && ok(n.protein, 0, 100) && ok(n.fat, 0, 100) &&
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
        fiber_100: ex.fiber ?? null,
        sugar_100: ex.sugar ?? null,
        salt_100: ex.salt ?? null,
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
        fiber_100: ex.fiber ?? null,
        sugar_100: ex.sugar ?? null,
        salt_100: ex.salt ?? null,
        portion_g: hasPortion ? pgNum : null,
        portion_name: hasPortion && pdef.name.trim() ? pdef.name.trim() : null,
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
        {t.diary.per100}. {initial.source === 'openfoodfacts' ? t.scan.sourceOff : initial.source === 'usda' ? t.scan.sourceUsda : t.diary.per100Hint}
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

      <details className="extras-form" open={Object.values(initial.extras).some((v) => v !== '')}>
        <summary>{t.extras.formSummary}</summary>
        <div className="grid3">
          {(['fiber', 'sugar', 'salt'] as const).map((k) => (
            <label className="field" key={k}>
              <span>{t.extras[k]}</span>
              <input
                inputMode="decimal"
                placeholder={t.extras.notSpecified}
                value={extras[k]}
                onChange={(e) => setExtras({ ...extras, [k]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <p className="muted small">{t.extras.formHint}</p>
        {!extrasValid && <p className="error small">{t.extras.invalid}</p>}
      </details>

      <div className="field">
        <span>{hasPortion ? t.portion.amount : t.diary.grams}</span>
        {hasPortion && (
          <div className="segmented" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className={unit === 'g' ? 'active' : ''}
              onClick={() => {
                if (unit === 'portion' && g !== null) setGrams(String(g));
                setUnit('g');
              }}
            >
              {t.portion.grams}
            </button>
            <button
              type="button"
              className={unit === 'portion' ? 'active' : ''}
              onClick={() => {
                if (unit === 'g') {
                  const c = ok(g, 0.01, 5000) ? portionCountFor(g!, pgNum!) : null;
                  setCount(c !== null ? formatCount(c) : '1');
                }
                setUnit('portion');
              }}
            >
              {portionWord}
            </button>
          </div>
        )}
        {byPortion ? (
          <>
            <div className="stepper">
              <button
                type="button"
                className="secondary"
                aria-label={t.portion.minus}
                onClick={() => setCount(formatCount(stepCount(ok(cnt, 0.01, 1000) ? cnt! : 1, -1)))}
              >
                −
              </button>
              <input inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} />
              <button
                type="button"
                className="secondary"
                aria-label={t.portion.plus}
                onClick={() => setCount(formatCount(stepCount(ok(cnt, 0.01, 1000) ? cnt! : 0, 1)))}
              >
                +
              </button>
            </div>
            {g !== null && (
              <p className="muted small">
                {t.portion.sum
                  .replace('{n}', formatCount(cnt!))
                  .replace('{g}', fmtG(pgNum!))
                  .replace('{total}', fmtG(g))}
              </p>
            )}
          </>
        ) : (
          <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
        )}
      </div>

      {!onIngredient && (
        <details className="extras-form" open={hasPortion}>
          <summary>{t.portion.summary}</summary>
          <div className="grid2">
            <label className="field">
              <span>{t.portion.name}</span>
              <input
                value={pdef.name}
                maxLength={20}
                placeholder={t.portion.namePlaceholder}
                onChange={(e) => setPdef({ ...pdef, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t.portion.weight}</span>
              <input
                inputMode="decimal"
                value={pdef.grams}
                onChange={(e) => {
                  const v = e.target.value;
                  // Прибрали вагу порції під час вводу порціями — переходимо на грами, щоб не втратити кількість
                  if (v.trim() === '' && unit === 'portion' && g !== null) setGrams(String(g));
                  setPdef({ ...pdef, grams: v });
                }}
              />
            </label>
          </div>
          <p className="muted small">{t.portion.hint}</p>
          {!portionValid && <p className="error small">{t.portion.invalid}</p>}
        </details>
      )}

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

/** Продукт зі списку «Часто їмо»: натискання відкриває форму зі звичною кількістю, «+» додає одразу */
function FrequentRow({
  food,
  meal,
  date,
  onSaved,
  onOpen,
}: {
  food: FrequentFood;
  meal: Meal;
  date: string;
  onSaved: () => Promise<void>;
  onOpen: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const complete =
    food.kcal_100 !== null && food.protein_100 !== null && food.fat_100 !== null && food.carbs_100 !== null;

  async function quickAdd() {
    if (busy || !complete) return;
    setBusy(true);
    setError('');
    try {
      await addEntry({
        date,
        meal,
        name: food.name,
        amount_g: food.last_amount_g,
        kcal_100: food.kcal_100!,
        protein_100: food.protein_100!,
        fat_100: food.fat_100!,
        carbs_100: food.carbs_100!,
        barcode: food.barcode,
        brand: food.brand,
        country: food.country,
        image_url: food.image_url,
        fiber_100: food.fiber_100 ?? null,
        sugar_100: food.sugar_100 ?? null,
        salt_100: food.salt_100 ?? null,
      });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="quick-row">
        <button type="button" className="entry food-row" onClick={onOpen}>
          <Thumb url={food.image_url} />
          <span className="entry-main">
            <span className="entry-name">{food.name}</span>
            <span className="muted small">
              {t.quick.usual} {fmtG(food.last_amount_g)} г
              {food.kcal_100 !== null
                ? ` · ${fmtKcal(portion(
                    { kcal: food.kcal_100, protein: food.protein_100 ?? 0, fat: food.fat_100 ?? 0, carbs: food.carbs_100 ?? 0 },
                    food.last_amount_g,
                  ).kcal)} ${t.home.kcal}`
                : ''}
            </span>
          </span>
        </button>
        {complete && (
          <button
            type="button"
            className="quick-plus"
            disabled={busy}
            aria-label={t.quick.quickAdd}
            onClick={() => void quickAdd()}
          >
            +
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

/** Збережені комбінації продуктів («мій звичайний сніданок») */
function CombosStep({ meal, date, onSaved }: { meal: Meal; date: string; onSaved: () => Promise<void> }) {
  const [list, setList] = useState<MealTemplate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getTemplates().then(setList).catch(() => setFailed(true));
  }, []);

  async function add(id: string) {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      await applyTemplate({ id, date, meal });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy('');
    }
  }

  async function remove(id: string) {
    if (busy) return;
    if (confirm !== id) {
      setConfirm(id);
      return;
    }
    setBusy(id);
    setError('');
    try {
      await deleteTemplate(id);
      setList((l) => (l ? l.filter((x) => x.id !== id) : l));
      setConfirm('');
    } catch (e) {
      setError(errorText(e));
    }
    setBusy('');
  }

  if (failed) return <p className="error">{t.errors.server}</p>;
  if (!list) return <Spinner />;
  if (list.length === 0) return <p className="muted">{t.quick.combosEmpty}</p>;

  return (
    <>
      {list.map((c) => {
        const total = sum(
          c.items.map((i) =>
            portion({ kcal: i.kcal_100, protein: i.protein_100, fat: i.fat_100, carbs: i.carbs_100 }, i.amount_g),
          ),
        );
        return (
          <div className="combo" key={c.id}>
            <div className="combo-head">
              <b>{c.name}</b>
              <span className="muted small">
                {c.items.length} {t.quick.items} · {fmtKcal(total.kcal)} {t.home.kcal}
              </span>
            </div>
            <div className="muted small combo-items">
              {c.items.map((i) => `${i.name} ${fmtG(i.amount_g)} г`).join(', ')}
            </div>
            <div className="combo-actions">
              <button type="button" className="primary" disabled={!!busy} onClick={() => void add(c.id)}>
                {busy === c.id ? t.quick.adding : `+ ${t.quick.addCombo}`}
              </button>
              <button type="button" className="danger" disabled={!!busy} onClick={() => void remove(c.id)}>
                {confirm === c.id ? t.quick.confirmRemove : t.quick.removeCombo}
              </button>
            </div>
          </div>
        );
      })}
      {error && <p className="error">{error}</p>}
    </>
  );
}

function SearchStep({ onPick, onManual }: { onPick: (f: Food) => void; onManual: () => void }) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
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

  const empty = result && result.saved.length === 0 && result.usda.length === 0 && result.off.length === 0;

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
          {(result.usda_status === 'error' || result.usda_status === 'no_key') && (
            <p className="muted small">{t.scan.usdaUnavailable}</p>
          )}
          {result.saved.length > 0 && (
            <>
              <h3 className="subhead">{t.scan.mySaved}</h3>
              {result.saved.map((f) => (
                <FoodRow key={f.id ?? f.name} food={f} onPick={() => onPick(f)} />
              ))}
            </>
          )}
          {result.usda.length > 0 && (
            <>
              <h3 className="subhead">{t.scan.usdaResults}</h3>
              {result.usda.map((f, i) => (
                <FoodRow key={f.name + (f.brand ?? '') + i} food={f} onPick={() => onPick(f)} />
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
  const [frequent, setFrequent] = useState<FrequentFood[]>([]);

  useEffect(() => {
    recentFoods().then(setRecent).catch(() => setRecent([]));
    if (!onIngredient) frequentFoods().then(setFrequent).catch(() => setFrequent([]));
  }, [onIngredient]);

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
        {!onIngredient && (
          <button type="button" className="add" onClick={() => setStep({ k: 'combos' })}>
            ⭐ {t.quick.combos}
          </button>
        )}
        {frequent.length > 0 && (
          <>
            <h3 className="subhead">{t.quick.frequent}</h3>
            <p className="muted small">{t.quick.frequentHint}</p>
            {frequent.map((f) => (
              <FrequentRow
                key={f.id ?? f.name}
                food={f}
                meal={meal}
                date={date}
                onSaved={onSaved}
                onOpen={() =>
                  setStep({
                    k: 'form',
                    draft: { ...draftFromFood(f), amount: String(f.last_amount_g) },
                    back: 'menu',
                  })
                }
              />
            ))}
          </>
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

  if (step.k === 'combos') {
    return (
      <Sheet title={t.quick.combosTitle} onClose={onClose} onBack={toMenu}>
        <CombosStep meal={meal} date={date} onSaved={onSaved} />
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
