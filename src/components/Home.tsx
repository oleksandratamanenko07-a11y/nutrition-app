import { useState } from 'react';
import { t } from '../i18n/uk';
import type { Day, Profile } from '../lib/api';
import { fmtG, fmtKcal, totals } from '../lib/day';

function Ring({ eaten, goal }: { eaten: number; goal: number }) {
  const R = 84;
  const C = 2 * Math.PI * R;
  const ratio = goal > 0 ? Math.min(eaten / goal, 1) : 0;
  const over = goal > 0 && eaten > goal;
  const left = goal - eaten;

  return (
    <div className="ring">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="ring-bg" cx="100" cy="100" r={R} />
        <circle
          className={over ? 'ring-fg over' : 'ring-fg'}
          cx="100"
          cy="100"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
          transform="rotate(-90 100 100)"
        />
      </svg>
      <div className="ring-center">
        <div className="ring-label">{over ? t.home.over : t.home.remaining}</div>
        <div className="ring-value">{fmtKcal(Math.abs(left))}</div>
        <div className="ring-unit">{t.home.kcal}</div>
      </div>
    </div>
  );
}

function MacroBar({
  label,
  value,
  goal,
  color,
}: {
  label: string;
  value: number;
  goal: number;
  color: string;
}) {
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  return (
    <div className="macro">
      <div className="macro-head">
        <span>{label}</span>
        <span className="muted">
          {fmtG(value)} / {goal} {t.home.g}
        </span>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function Home({
  profile,
  day,
  onWater,
}: {
  profile: Profile;
  day: Day;
  onWater: (ml: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const sum = totals(day.entries);
  const kcalGoal = profile.kcal_goal ?? 0;
  const waterGoal = profile.water_goal_ml ?? 2000;
  const waterPct = waterGoal > 0 ? Math.min((day.water_ml / waterGoal) * 100, 100) : 0;

  async function water(ml: number) {
    if (busy) return;
    setBusy(true);
    try {
      await onWater(ml);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card center-card">
        <Ring eaten={sum.kcal} goal={kcalGoal} />
        <div className="kcal-row">
          <div>
            <div className="kcal-num">{fmtKcal(sum.kcal)}</div>
            <div className="muted small">{t.home.eaten}</div>
          </div>
          <div>
            <div className="kcal-num">{fmtKcal(kcalGoal)}</div>
            <div className="muted small">{t.home.goal}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <MacroBar
          label={t.home.protein}
          value={sum.protein}
          goal={profile.protein_goal_g ?? 0}
          color="var(--protein)"
        />
        <MacroBar
          label={t.home.fat}
          value={sum.fat}
          goal={profile.fat_goal_g ?? 0}
          color="var(--fat)"
        />
        <MacroBar
          label={t.home.carbs}
          value={sum.carbs}
          goal={profile.carbs_goal_g ?? 0}
          color="var(--carbs)"
        />
      </section>

      <section className="card">
        <div className="macro-head">
          <h2>{t.home.water}</h2>
          <span className="muted">
            {day.water_ml.toLocaleString('uk-UA')} / {waterGoal.toLocaleString('uk-UA')} {t.home.ml}
          </span>
        </div>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${waterPct}%`, background: 'var(--water)' }} />
        </div>
        <div className="water-buttons">
          <button type="button" className="secondary" disabled={busy} onClick={() => void water(-250)}>
            −250
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void water(250)}>
            +250
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void water(500)}>
            +500
          </button>
        </div>
      </section>
    </>
  );
}
