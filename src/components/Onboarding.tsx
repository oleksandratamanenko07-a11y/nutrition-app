import { useMemo, useState } from 'react';
import { t } from '../i18n/uk';
import { computeGoals, type Activity, type Goal, type Sex } from '../lib/calc';
import { ApiError, saveProfile, type Profile } from '../lib/api';
import { localDate } from '../lib/telegram';

function parse(v: string): number | null {
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

const ACTIVITIES: Activity[] = ['sedentary', 'light', 'moderate', 'high', 'very_high'];
const GOALS: Goal[] = ['lose', 'maintain', 'gain'];

export function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [sex, setSex] = useState<Sex>('female');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [target, setTarget] = useState('');
  const [activity, setActivity] = useState<Activity>('light');
  const [goal, setGoal] = useState<Goal>('maintain');
  const [manual, setManual] = useState<Partial<Record<'kcal' | 'protein' | 'fat' | 'carbs' | 'water', string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const a = parse(age);
  const h = parse(height);
  const w = parse(weight);
  const tw = parse(target);
  const valid =
    a !== null && a >= 10 && a <= 100 &&
    h !== null && h >= 100 && h <= 250 &&
    w !== null && w >= 30 && w <= 300 &&
    tw !== null && tw >= 30 && tw <= 300;

  const auto = useMemo(
    () =>
      valid
        ? computeGoals({ sex, age: a!, heightCm: h!, weightKg: w!, activity, goal })
        : null,
    [valid, sex, a, h, w, activity, goal],
  );

  const val = (key: 'kcal' | 'protein' | 'fat' | 'carbs', fallback: number | undefined) =>
    manual[key] ?? (fallback !== undefined ? String(fallback) : '');

  const kcal = parse(val('kcal', auto?.kcal));
  const protein = parse(val('protein', auto?.protein));
  const fat = parse(val('fat', auto?.fat));
  const carbs = parse(val('carbs', auto?.carbs));
  const water = parse(manual.water ?? '2000');
  const goalsOk =
    kcal !== null && kcal >= 800 && kcal <= 6000 &&
    protein !== null && protein >= 0 && protein <= 500 &&
    fat !== null && fat >= 0 && fat <= 400 &&
    carbs !== null && carbs >= 0 && carbs <= 1000 &&
    water !== null && water >= 500 && water <= 6000;

  async function submit() {
    if (!valid || !goalsOk || saving) return;
    setSaving(true);
    setError('');
    try {
      const profile = await saveProfile({
        sex,
        age: a!,
        height_cm: h!,
        weight_kg: w!,
        target_weight_kg: tw!,
        activity_level: activity,
        goal,
        kcal_goal: kcal!,
        protein_goal_g: protein!,
        fat_goal_g: fat!,
        carbs_goal_g: carbs!,
        water_goal_ml: water!,
        today: localDate(),
      });
      onDone(profile);
    } catch (e) {
      const kind = e instanceof ApiError ? e.kind : 'server';
      setError(t.errors[kind]);
      setSaving(false);
    }
  }

  return (
    <main className="screen">
      <h1>{t.onboarding.title}</h1>
      <p className="muted">{t.onboarding.subtitle}</p>

      <section className="card">
        <label className="field">
          <span>{t.onboarding.sex}</span>
          <div className="segmented">
            {(['female', 'male'] as Sex[]).map((s) => (
              <button
                key={s}
                type="button"
                className={sex === s ? 'active' : ''}
                onClick={() => setSex(s)}
              >
                {t.onboarding[s]}
              </button>
            ))}
          </div>
        </label>

        <div className="grid2">
          <label className="field">
            <span>{t.onboarding.age}</span>
            <input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} />
          </label>
          <label className="field">
            <span>{t.onboarding.height}</span>
            <input inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} />
          </label>
          <label className="field">
            <span>{t.onboarding.weight}</span>
            <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </label>
          <label className="field">
            <span>{t.onboarding.targetWeight}</span>
            <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>{t.onboarding.activity}</span>
          <select value={activity} onChange={(e) => setActivity(e.target.value as Activity)}>
            {ACTIVITIES.map((x) => (
              <option key={x} value={x}>
                {t.activity[x]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{t.onboarding.goal}</span>
          <div className="segmented">
            {GOALS.map((x) => (
              <button
                key={x}
                type="button"
                className={goal === x ? 'active' : ''}
                onClick={() => setGoal(x)}
              >
                {t.goal[x]}
              </button>
            ))}
          </div>
        </label>
      </section>

      {auto && (
        <section className="card">
          <h2>{t.onboarding.yourNorm}</h2>
          <p className="muted small">{t.onboarding.editHint}</p>
          <div className="grid2">
            <label className="field">
              <span>{t.onboarding.kcal}</span>
              <input
                inputMode="numeric"
                value={val('kcal', auto.kcal)}
                onChange={(e) => setManual({ ...manual, kcal: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t.onboarding.water}</span>
              <input
                inputMode="numeric"
                value={manual.water ?? '2000'}
                onChange={(e) => setManual({ ...manual, water: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t.onboarding.protein}</span>
              <input
                inputMode="numeric"
                value={val('protein', auto.protein)}
                onChange={(e) => setManual({ ...manual, protein: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t.onboarding.fat}</span>
              <input
                inputMode="numeric"
                value={val('fat', auto.fat)}
                onChange={(e) => setManual({ ...manual, fat: e.target.value })}
              />
            </label>
            <label className="field">
              <span>{t.onboarding.carbs}</span>
              <input
                inputMode="numeric"
                value={val('carbs', auto.carbs)}
                onChange={(e) => setManual({ ...manual, carbs: e.target.value })}
              />
            </label>
          </div>
          <p className="muted small">{t.onboarding.disclaimer}</p>
        </section>
      )}

      {error && <p className="error">{error}</p>}

      <button
        type="button"
        className="primary"
        disabled={!valid || !goalsOk || saving}
        onClick={submit}
      >
        {saving ? t.onboarding.saving : t.onboarding.save}
      </button>
    </main>
  );
}
