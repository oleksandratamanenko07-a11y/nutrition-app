import { useEffect, useState } from 'react';
import { t } from '../i18n/uk';
import type { Day, Entry, Profile } from '../lib/api';
import { goalStatus } from '../lib/calc';
import { fmtG, fmtKcal, totals } from '../lib/day';
import { macroBreakdown, type Breakdown } from '../lib/breakdown';
import {
  EXTRA_KEYS,
  extraPct,
  extrasBreakdown,
  extrasTotal,
  extraZone,
  referenceFor,
  type ExtraKey,
} from '../lib/extras';
import { AchievementsSummary } from './Achievements';
import { getMacroView, onMacroViewChange, type MacroView } from '../lib/prefs';
import { ringFill, ringPercent } from '../lib/ring';
import { Sheet } from './ui';

function Ring({ eaten, goal, onOpen }: { eaten: number; goal: number; onOpen: () => void }) {
  const R = 84;
  const C = 2 * Math.PI * R;
  const ratio = goal > 0 ? Math.min(eaten / goal, 1) : 0;
  const over = goal > 0 && eaten > goal;
  const left = goal - eaten;
  const status = goalStatus(eaten, goal);

  return (
    <button type="button" className={`ring st-${status}`} onClick={onOpen} aria-label={t.home.caloriesTitle}>
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
    </button>
  );
}

const STATUS_TEXT = { low: t.home.statusLow, ok: t.home.statusOk, high: t.home.statusHigh } as const;

const MACRO_LABEL: Record<Breakdown, string> = {
  kcal: t.home.caloriesTitle,
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

/** Один макронутрієнт у вигляді кільця: відсоток від цілі всередині, грами під кільцем. Колір — за тими самими зонами. */
function MacroRing({ label, value, goal, onOpen }: { label: string; value: number; goal: number; onOpen: () => void }) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const status = goalStatus(value, goal);
  const pct = ringPercent(value, goal, status);
  return (
    <button type="button" className={`mring st-${status}`} onClick={onOpen} title={STATUS_TEXT[status]}>
      <span className="mring-wrap">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="mring-bg" cx="50" cy="50" r={R} />
          <circle
            className="mring-fg"
            cx="50"
            cy="50"
            r={R}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - ringFill(value, goal))}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <span className="mring-center">
          {pct === null ? (
            <span className="mring-pct">—</span>
          ) : (
            <span className="mring-pct">
              {pct}
              <small>%</small>
            </span>
          )}
        </span>
      </span>
      <span className="mring-label">
        {label} <span className="chev">›</span>
      </span>
      <span className="mring-grams">
        {goal > 0 ? (
          <>
            <b>{fmtG(value)}</b> {t.home.of} {goal} {t.home.g}
          </>
        ) : (
          <b>
            {fmtG(value)} {t.home.g}
          </b>
        )}
      </span>
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
  macro: Breakdown;
  entries: Entry[];
  goal: number;
  onClose: () => void;
}) {
  const { rows, total } = macroBreakdown(entries, macro);
  const isKcal = macro === 'kcal';
  const fmtV = isKcal ? fmtKcal : fmtG;
  const unit = isKcal ? t.home.kcal : t.home.g;
  const status = goalStatus(total, goal);
  const pct = goal > 0 ? Math.min((total / goal) * 100, 100) : 0;
  return (
    <Sheet title={MACRO_LABEL[macro]} onClose={onClose}>
      <div className={`st-${status}`}>
        <div className="macro-head">
          <span className="muted">{t.home.eaten}</span>
          <span className="st-text">
            {fmtV(total)} / {fmtV(goal)} {unit}
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
              {fmtV(r.value)} {unit}
            </b>
          </div>
        ))}
        {rows.length > 0 && (
          <div className="macro-row macro-total">
            <span>{t.home.macroTotal}</span>
            <b>
              {fmtV(total)} {unit}
            </b>
          </div>
        )}
      </div>
    </Sheet>
  );
}

const nf1 = (x: number) => fmtG(x);

function refText(k: ExtraKey, amount: number): string {
  return (k === 'fiber' ? t.extras.refFiber : t.extras.refMax).replace('{n}', String(amount));
}

/** Окремий від КБЖУ блок: клітковина, цукор, сіль. Дані необов'язкові, тому завжди видно, для скількох записів вони відомі. */
function ExtrasCard({ entries, kcalGoal, onOpen }: { entries: Entry[]; kcalGoal: number | null; onOpen: (k: ExtraKey) => void }) {
  const [open, setOpen] = useState(false); // завжди згорнуто при відкритті головної
  if (entries.length === 0) return null;
  const partialTotal = extrasTotal(entries, 'fiber');
  return (
    <section className={`card extras-card ${open ? 'open' : ''}`}>
      <button type="button" className="extras-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{t.extras.title}</span>
        <span className="extras-chev" aria-hidden="true">›</span>
      </button>
      <div className="extras-body">
        <div className="extras-inner">
      {EXTRA_KEYS.map((k) => {
        const tot = extrasTotal(entries, k);
        const ref = referenceFor(k, kcalGoal);
        const zone = extraZone(tot, ref);
        const pct = Math.min(extraPct(tot, ref), 100);
        return (
          <button type="button" key={k} className={`macro macro-btn ${zone ? `st-${zone}` : ''}`} onClick={() => onOpen(k)}>
            <div className="macro-head">
              <span>
                {t.extras[k]} <span className="chev">›</span>
              </span>
              <span className={zone ? 'st-text' : 'muted'}>
                {tot.known === 0
                  ? t.extras.noData
                  : `${tot.missing > 0 ? `${t.extras.atLeast} ` : ''}${nf1(tot.value)} ${t.home.g}`}
                <span className="muted small"> · {refText(k, ref.amount)}</span>
              </span>
            </div>
            <div className="bar">
              <div className={`bar-fill ${zone ? 'st-fill' : 'bar-neutral'}`} style={{ width: `${tot.known === 0 ? 0 : pct}%` }} />
            </div>
            {tot.known > 0 && tot.missing > 0 && (
              <div className="muted small extras-partial">
                {t.extras.partial.replace('{known}', String(tot.known)).replace('{count}', String(tot.count))}
              </div>
            )}
          </button>
        );
      })}
      {partialTotal.count > 0 && <p className="muted small legend">{t.extras.dishPartial}</p>}
        </div>
      </div>
    </section>
  );
}

/** Внесок кожного запису в клітковину, цукор або сіль за день; записи без даних — окремо, як «не вказано». */
function ExtrasSheet({ k, entries, kcalGoal, onClose }: { k: ExtraKey; entries: Entry[]; kcalGoal: number | null; onClose: () => void }) {
  const { rows, total } = extrasBreakdown(entries, k);
  const ref = referenceFor(k, kcalGoal);
  const zone = extraZone(total, ref);
  const pct = Math.min(extraPct(total, ref), 100);
  return (
    <Sheet title={t.extras[k]} onClose={onClose}>
      <div className={zone ? `st-${zone}` : ''}>
        <div className="macro-head">
          <span className="muted">{t.home.eaten}</span>
          <span className={zone ? 'st-text' : ''}>
            {total.known === 0 ? t.extras.noData : `${total.missing > 0 ? `${t.extras.atLeast} ` : ''}${nf1(total.value)} ${t.home.g}`}
            <span className="muted small"> · {refText(k, ref.amount)}</span>
          </span>
        </div>
        <div className="bar">
          <div className={`bar-fill ${zone ? 'st-fill' : 'bar-neutral'}`} style={{ width: `${total.known === 0 ? 0 : pct}%` }} />
        </div>
      </div>
      {total.known > 0 && total.missing > 0 && (
        <p className="muted small">{t.extras.partial.replace('{known}', String(total.known)).replace('{count}', String(total.count))}</p>
      )}
      {total.known === 0 && <p className="muted">{t.extras.allMissing}</p>}

      <div className="macro-list">
        {rows.map((r) => (
          <div className="macro-row" key={r.id}>
            <span className="entry-main">
              <span className="entry-name">
                {r.name}
                {r.isDish && <span className="badge">{t.home.dishBadge}</span>}
              </span>
              <span className="muted small">
                {t.meals[r.meal as Entry['meal']]} · {fmtG(r.amount_g)} {t.home.g}
              </span>
            </span>
            <b className={r.value === null ? 'missing' : ''}>
              {r.value === null ? t.extras.notSpecified : `${nf1(r.value)} ${t.home.g}`}
            </b>
          </div>
        ))}
      </div>
      <p className="muted small">{t.extras.note}</p>
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
  const [openMacro, setOpenMacro] = useState<Breakdown | null>(null);
  const [macroView, setMacroViewState] = useState<MacroView>(getMacroView);
  useEffect(() => onMacroViewChange(setMacroViewState), []);
  const [openExtra, setOpenExtra] = useState<ExtraKey | null>(null);
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
        <Ring eaten={sum.kcal} goal={kcalGoal} onOpen={() => setOpenMacro('kcal')} />
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
        {macroView === 'rings' ? (
          <div className="macro-rings">
            <MacroRing label={t.home.protein} value={sum.protein} goal={profile.protein_goal_g ?? 0} onOpen={() => setOpenMacro('protein')} />
            <MacroRing label={t.home.fat} value={sum.fat} goal={profile.fat_goal_g ?? 0} onOpen={() => setOpenMacro('fat')} />
            <MacroRing label={t.home.carbs} value={sum.carbs} goal={profile.carbs_goal_g ?? 0} onOpen={() => setOpenMacro('carbs')} />
          </div>
        ) : (
          <>
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
          </>
        )}
      </section>

      <ExtrasCard entries={day.entries} kcalGoal={profile.kcal_goal} onOpen={setOpenExtra} />

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
      {openExtra && (
        <ExtrasSheet k={openExtra} entries={day.entries} kcalGoal={profile.kcal_goal} onClose={() => setOpenExtra(null)} />
      )}
      {openMacro && (
        <MacroSheet
          macro={openMacro}
          entries={day.entries}
          goal={openMacro === 'kcal' ? kcalGoal : profile[`${openMacro}_goal_g`] ?? 0}
          onClose={() => setOpenMacro(null)}
        />
      )}
    </>
  );
}
