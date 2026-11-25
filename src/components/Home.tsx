import { useState } from 'react';
import { t } from '../i18n/uk';
import type { Day, Profile } from '../lib/api';
import { goalStatus } from '../lib/calc';
import { fmtG, fmtKcal, totals } from '../lib/day';
import { AchievementsSummary } from './Achievements';

function Ring({ eaten, goal }: { eaten: number; goal: number }) {
  const R = 84;
  const C = 2 * Math.PI * R;
  const ratio = goal > 0 ? Math.min(eaten / goal, 1) : 0;
  const over = goal > 0 && eaten > goal;
  const left = goal - eaten;
  const status = goalStatus(eaten, goal);

  return (
    <div className={`ring st-${status}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="ring-bg" cx="100" cy="100" r={R} />
        <circle
          className="ring-fg"
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

const STATUS_TEXT = { low: t.home.statusLow, ok: t.home.statusOk, high: t.home.statusHigh } as const;

function MacroBar({ label, value, goal }: { label: string; value: number; goal: number }) {
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  const status = goalStatus(value, goal);
  return (
    <div className={`macro st-${status}`}>
      <div className="macro-head">
        <span>{label}</span>
        <span className="st-text" title={STATUS_TEXT[status]}>
          {fmtG(value)} / {goal} {t.home.g}
        </span>
      </div>
      <div className="bar">
        <div className="bar-fill st-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Home({
  profile,
  day,
  onWater,
  days,
  today,
}: {
  profile: Profile;
  day: Day;
  onWater: (ml: number) => Promise<void>;
  days: string[] | null;
  today: string;
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
        />
        <MacroBar
          label={t.home.fat}
          value={sum.fat}
          goal={profile.fat_goal_g ?? 0}
        />
        <MacroBar
          label={t.home.carbs}
          value={sum.carbs}
          goal={profile.carbs_goal_g ?? 0}
        />
        <p className="muted small legend">{t.home.legend}</p>
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
      {days && <AchievementsSummary days={days} today={today} />}
    </>
  );
}
