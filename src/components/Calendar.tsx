import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n/uk';
import { getHistory, type Entry, type Meal } from '../lib/api';
import { goalStatus } from '../lib/calc';
import { entryPortion, fmtG, fmtKcal } from '../lib/day';
import {
  dateKey,
  monthGrid,
  pad,
  summarizeMonth,
  type DayStatus,
  type DaySummary,
  type GoalRow,
} from '../lib/history';
import { MEALS, Sheet } from './ui';

const STATUS_CLASS: Record<DayStatus, string> = { low: 'st-low', ok: 'st-ok', high: 'st-high' };

function DaySheet({
  date,
  summary,
  entries,
  onClose,
}: {
  date: string;
  summary: DaySummary | undefined;
  entries: Entry[];
  onClose: () => void;
}) {
  const [y, m, d] = date.split('-').map(Number);
  const title = `${d} ${t.calendar.months[m - 1].toLowerCase()} ${y}`;
  const goal = summary?.goal ?? null;
  const pct = summary && goal && goal.kcal_goal > 0 ? Math.round((summary.kcal / goal.kcal_goal) * 100) : null;
  const cls = summary?.status ? STATUS_CLASS[summary.status] : '';

  const macro = (label: string, value: number, g: number | null | undefined) => {
    const st = g && g > 0 ? STATUS_CLASS[goalStatus(value, g)] : '';
    return (
      <div className={`day-macro ${st}`}>
        <div className="muted small">{label}</div>
        <div className="st-text">
          {fmtG(value)}
          {g ? ` / ${g}` : ''} {t.home.g}
        </div>
      </div>
    );
  };

  return (
    <Sheet title={title} onClose={onClose}>
      {!summary || summary.count === 0 ? (
        <p className="muted">{t.calendar.noEntries}</p>
      ) : (
        <>
          <div className={`card-inner ${cls}`}>
            <div className="day-kcal">
              <span className="st-text big-num">{fmtKcal(summary.kcal)}</span>
              {goal && <span className="muted"> / {fmtKcal(goal.kcal_goal)} {t.home.kcal}</span>}
            </div>
            {pct !== null && (
              <div className="st-text">
                {pct}% · {t.calendar.percent}
              </div>
            )}
            {!goal && <p className="muted small">{t.calendar.noGoal}</p>}
          </div>

          <div className="day-macros">
            {macro(t.home.protein, summary.protein, goal?.protein_goal_g)}
            {macro(t.home.fat, summary.fat, goal?.fat_goal_g)}
            {macro(t.home.carbs, summary.carbs, goal?.carbs_goal_g)}
          </div>

          {MEALS.map((meal: Meal) => {
            const items = entries.filter((e) => e.meal === meal);
            if (items.length === 0) return null;
            const kcal = items.reduce((s, e) => s + entryPortion(e).kcal, 0);
            return (
              <div key={meal}>
                <div className="meal-head" style={{ marginTop: 14 }}>
                  <h2>{t.meals[meal]}</h2>
                  <span className="muted">
                    {fmtKcal(kcal)} {t.home.kcal}
                  </span>
                </div>
                {items.map((e) => (
                  <div className="macro-row" key={e.id}>
                    <span className="entry-main">
                      <span className="entry-name">
                        {e.name}
                        {e.recipe_snapshot && e.recipe_snapshot.length > 0 && (
                          <span className="badge">{t.home.dishBadge}</span>
                        )}
                      </span>
                      <span className="muted small">{fmtG(e.amount_g)} г</span>
                    </span>
                    <b>{fmtKcal(entryPortion(e).kcal)}</b>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}
    </Sheet>
  );
}

export function Calendar({ today, onClose }: { today: string; onClose: () => void }) {
  const [ty, tm] = today.split('-').map(Number);
  const [cursor, setCursor] = useState({ y: ty, m: tm - 1 });
  const [data, setData] = useState<{ entries: Entry[]; goals: GoalRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const isCurrent = cursor.y === ty && cursor.m === tm - 1;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getHistory(`${cursor.y}-${pad(cursor.m + 1)}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cursor, attempt]);

  const summary = useMemo(
    () => (data ? summarizeMonth(data.entries, data.goals, goalStatus) : null),
    [data],
  );

  const grid = monthGrid(cursor.y, cursor.m);
  const shift = (delta: number) => {
    setData(null);
    setCursor(({ y, m }) => {
      const n = m + delta;
      return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
    });
  };

  const cells: (number | null)[] = [
    ...Array.from({ length: grid.lead }, () => null),
    ...Array.from({ length: grid.days }, (_, i) => i + 1),
  ];

  return (
    <>
      <button type="button" className="back-link" onClick={onClose}>
        ‹ {t.calendar.back}
      </button>
      <h1>{t.calendar.title}</h1>

      <section className="card">
        <div className="datebar">
          <button type="button" className="icon" aria-label={t.calendar.prevMonth} onClick={() => shift(-1)}>
            ‹
          </button>
          <span className="datebar-title">
            {t.calendar.months[cursor.m]} {cursor.y}
          </span>
          <button
            type="button"
            className="icon"
            aria-label={t.calendar.nextMonth}
            disabled={isCurrent}
            onClick={() => shift(1)}
          >
            ›
          </button>
        </div>

        <div className="cal-grid cal-weekdays">
          {t.calendar.weekdays.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className={`cal-grid${loading ? ' cal-loading' : ''}`}>
          {cells.map((day, i) => {
            if (day === null) return <span key={`b${i}`} />;
            const key = dateKey(cursor.y, cursor.m, day);
            const s = summary?.days[key];
            const future = key > today;
            const cls = s?.status ? STATUS_CLASS[s.status] : s ? 'st-none-logged' : '';
            return (
              <button
                type="button"
                key={key}
                disabled={future}
                className={`cal-day ${cls}${s ? ' has' : ''}${key === today ? ' is-today' : ''}${future ? ' future' : ''}`}
                onClick={() => setSelected(key)}
                aria-label={key}
              >
                <span>{day}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="banner" style={{ marginTop: 12 }}>
            <span>{t.calendar.loadError}</span>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              {t.retry}
            </button>
          </div>
        )}

        <div className="cal-legend">
          <span className="st-low"><i /> {t.calendar.legendLow}</span>
          <span className="st-ok"><i /> {t.calendar.legendOk}</span>
          <span className="st-high"><i /> {t.calendar.legendHigh}</span>
          <span className="st-none"><i /> {t.calendar.legendNone}</span>
        </div>
      </section>

      <section className="card">
        <h2>{t.calendar.statsTitle}</h2>
        <div className="stats-grid">
          <div className="stat">
            <div className="stat-num">{summary?.stats.logged ?? '–'}</div>
            <div className="muted small">{t.calendar.logged}</div>
          </div>
          <div className="stat st-ok">
            <div className="stat-num st-text">{summary?.stats.ok ?? '–'}</div>
            <div className="muted small">{t.calendar.good}</div>
          </div>
          <div className="stat st-low">
            <div className="stat-num st-text">{summary?.stats.low ?? '–'}</div>
            <div className="muted small">{t.calendar.below}</div>
          </div>
          <div className="stat st-high">
            <div className="stat-num st-text">{summary?.stats.high ?? '–'}</div>
            <div className="muted small">{t.calendar.above}</div>
          </div>
        </div>
        <p className="muted small">{t.calendar.note}</p>
      </section>

      {selected && data && (
        <DaySheet
          date={selected}
          summary={summary?.days[selected]}
          entries={data.entries.filter((e) => e.entry_date === selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
