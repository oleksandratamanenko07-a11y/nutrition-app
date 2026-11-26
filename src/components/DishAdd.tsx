import { useState } from 'react';
import { t } from '../i18n/uk';
import { addEntry, type Meal, type Recipe } from '../lib/api';
import { portion } from '../lib/calc';
import { fmtG, fmtKcal } from '../lib/day';
import { dishExtrasPer100, dishPer100, dishTotals, fmt1, NUTRIENTS, type Nutrient } from '../lib/recipe';
import { errorText, MealPicker, ok, parseNum } from './ui';

const NAME: Record<Nutrient, string> = {
  kcal: t.diary.kcal,
  protein: t.diary.protein,
  fat: t.diary.fat,
  carbs: t.diary.carbs,
};

/** Додавання збереженої страви в щоденник: приймання їжі, порції або вага, перерахунок КБЖУ. */
export function DishAddForm({
  recipe,
  meal: initialMeal,
  date,
  onSaved,
}: {
  recipe: Recipe;
  meal: Meal;
  date: string;
  onSaved: () => Promise<void>;
}) {
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [unit, setUnit] = useState<'portions' | 'grams'>('portions');
  const [amount, setAmount] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const tot = dishTotals(recipe.ingredients, recipe.total_weight_g);
  const per100 = dishPer100(tot);
  const a = parseNum(amount);
  const grams =
    a === null ? null : unit === 'portions' ? Math.round(a * tot.weight * 100) / 100 : a;
  const valid = per100 !== null && ok(a, 0.01, 5000) && grams !== null && grams >= 0.01 && grams <= 5000;
  const preview = valid ? portion(per100!, grams!) : null;

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await addEntry({
        date,
        meal,
        name: recipe.name,
        amount_g: grams!,
        kcal_100: per100!.kcal,
        protein_100: per100!.protein,
        fat_100: per100!.fat,
        carbs_100: per100!.carbs,
        ...dishExtrasPer100(recipe.ingredients, tot.weight),
        source: 'recipe',
        recipe_snapshot: recipe.ingredients.map((i) => ({
          name: i.name,
          amount_g: i.amount_g,
          kcal_100: i.kcal_100,
          protein_100: i.protein_100,
          fat_100: i.fat_100,
          carbs_100: i.carbs_100,
          fiber_100: i.fiber_100 ?? null,
          sugar_100: i.sugar_100 ?? null,
          salt_100: i.salt_100 ?? null,
        })),
      });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <>
      {per100 === null && (
        <p className="error">
          {t.dishes.incomplete} {tot.missing.map((n) => NAME[n]).join(', ')}. {t.dishes.edit}.
        </p>
      )}

      <div className="segmented" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={unit === 'portions' ? 'active' : ''}
          onClick={() => {
            setUnit('portions');
            setAmount('1');
          }}
        >
          {t.dishes.portions}
        </button>
        <button
          type="button"
          className={unit === 'grams' ? 'active' : ''}
          onClick={() => {
            setUnit('grams');
            setAmount(String(Math.round(tot.weight * 100) / 100));
          }}
        >
          {t.dishes.byWeight}
        </button>
      </div>

      <label className="field">
        <span>{unit === 'portions' ? t.dishes.portionsLabel : t.dishes.gramsLabel}</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {unit === 'portions' && (
        <p className="muted small">{t.dishes.portionHint.replace('{w}', fmt1(tot.weight))}</p>
      )}

      <label className="field">
        <span>{t.diary.meal}</span>
        <MealPicker value={meal} onChange={setMeal} />
      </label>

      {preview && grams !== null && (
        <p className="preview">
          {t.dishes.totalAmount}: {fmtG(grams)} г · <b>{fmtKcal(preview.kcal)} {t.home.kcal}</b> · {t.diary.p}{' '}
          {fmtG(preview.protein)} · {t.diary.f} {fmtG(preview.fat)} · {t.diary.c} {fmtG(preview.carbs)}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <button type="button" className="primary" disabled={!valid || saving} onClick={() => void submit()}>
        {saving ? t.diary.saving : t.diary.addButton}
      </button>
    </>
  );
}

export { NUTRIENTS };
