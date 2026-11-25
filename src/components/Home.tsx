import { useState } from 'react';
import { t } from '../i18n/uk';
import type { Day, Entry, Profile } from '../lib/api';
import { goalStatus } from '../lib/calc';
import { fmtG, fmtKcal, totals } from '../lib/day';
import { macroBreakdown, type Macro } from '../lib/breakdown';
import { AchievementsSummary } from './Achievements';
import { Sheet } from './ui';

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

const MACRO_LABEL: Record<Macro, string> = {
  protein: t.home.protein,
  fat: t.home.fat,
  carbs: t.home.carbs,
};

/** Окреме поле макронутрієнта: кількість, ціль, смужка. Натискання відкриває розбивку по продуктах. */
function MacroBar({
  label,
  value,
  goal,
  onOpen,
}: {
  label: string;
  value: number;
  goal: number;
  onOpen: () => void;
}) {
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  const status = goalStatus(value, goal);
  return (
    <button type="button" className={`macro macro-btn st-${status}`} onClick={onOpen}>
      <div className="macro-head">
        <span>
          {label} <span className="chev">›</span>
        </span>
        <span className="st-text" title={STATUS_TEXT[status]}>
          {fmtG(value)} / {goal} {t.home.g}
        </span>
      </div>
      <div className="bar">
        <div className="bar-fill st-fill" style={{ width: `${pct}%` }} />
      </div>
    </button>
  );
}

/** Вікно з внеском кожного продукту чи страви в обраний макронутрієнт за день. */
function MacroSheet({
  macro,
  entries,
  goal,
  onClose,
}: {
  macro: Macro;
  entries: Entry[];
  goal: number;
  onClose: () => void;
}) {
  const { rows, total } = macroBreakdown(entries, macro);
  const status = goalStatus(total, goal);
  const pct = goal > 0 ? Math.min((total / goal) * 100, 100) : 0;
  return (
    <Sheet title={MACRO_LABEL[macro]} onClose={onClose}>
      <div className={`st-${status}`}>
        <div className="macro-head">
          <span className="muted">{t.home.eaten}</span>
          <span className="st-text">
            {fmtG(total)} / {goal} {t.home.g}
          </span>
        </div>
        <div className="bar">
          <div className="bar-fill st-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {rows.length === 0 && <p className="muted">{t.home.macroEmpty}</p>}

      <div className="macro-list">
        {rows.map((r) => (
          <div className="macro-row" key={r.id}>
            <span className="entry-main">
              <span className="entry-name">
                {r.name}
                {r.isDish && <span className="badge">{t.home.dishBadge}</span>}
              </span>
              <span className="muted small">
                {t.meals[r.meal]} · {fmtG(r.amount_g)} {t.home.g}
              </span>
            </span>
            <b>
              {fmtG(r.value)} {t.home.g}
            </b>
          </div>
        ))}
        {rows.length > 0 && (
          <div className="macro-row macro-total">
            <span>{t.home.macroTotal}</span>
            <b>
              {fmtG(total)} {t.home.g}
            </b>
          </div>
        )}
      </div>
    </Sheet>
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
  const [openMacro, setOpenMacro] = useState<Macro | null>(null);
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
          onOpen={() => setOpenMacro('protein')}
        />
        <MacroBar
          label={t.home.fat}
          value={sum.fat}
          goal={profile.fat_goal_g ?? 0}
          onOpen={() => setOpenMacro('fat')}
        />
        <MacroBar
          label={t.home.carbs}
          value={sum.carbs}
          goal={profile.carbs_goal_g ?? 0}
          onOpen={() => setOpenMacro('carbs')}
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
      {openMacro && (
        <MacroSheet
          macro={openMacro}
          entries={day.entries}
          goal={profile[`${openMacro}_goal_g`] ?? 0}
          onClose={() => setOpenMacro(null)}
        />
      )}
    </>
  );
}
