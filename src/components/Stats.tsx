import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n/uk';
import { getRange, type Entry } from '../lib/api';
import { goalStatus } from '../lib/calc';
import { fmtG, fmtKcal } from '../lib/day';
import { summarizeMonth, type GoalRow } from '../lib/history';
import {
  barGeometry,
  compare,
  macroShare,
  periodOf,
  periodStats,
  shiftPeriod,
  topProducts,
  type Nutrient,
  type Period,
  type PeriodKind,
  type Zone,
} from '../lib/stats';

const W = 320;
const H = 200;
const PAD = { l: 36, r: 6, t: 10, b: 24 };
const cls = (z: Zone | null) => (z ? `st-${z}` : '');

function localOf(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function periodLabel(p: Period): string {
  if (p.kind === 'month') {
    const d = localOf(p.from);
    return `${t.calendar.months[d.getMonth()]} ${d.getFullYear()}`;
  }
  const a = localOf(p.from);
  const b = localOf(p.to);
  const day = (x: Date) => x.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${day(b)}`
    : `${day(a)} – ${day(b)}`;
}

const signed = (v: number, f: (x: number) => string) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));

export function Stats({ today, onClose }: { today: string; onClose: () => void }) {
  const [kind, setKind] = useState<PeriodKind>('week');
  const [anchor, setAnchor] = useState(today);
  const [data, setData] = useState<{ entries: Entry[]; goals: GoalRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const period = useMemo(() => periodOf(kind, anchor), [kind, anchor]);
  const prev = useMemo(() => shiftPeriod(period, -1), [period]);
  const isLatest = period.to >= today;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    setSelected(null);
    getRange(prev.from, period.to)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [prev.from, period.to, attempt]);

  const model = useMemo(() => {
    if (!data) return null;
    const { days } = summarizeMonth(data.entries, data.goals, goalStatus);
    const cur = periodStats(days, period, today, goalStatus);
    const old = periodStats(days, prev, today, goalStatus);
    return {
      days,
      cur,
      diff: compare(cur, old),
      share: cur.avg ? macroShare(cur.avg) : null,
      top: topProducts(data.entries, period, today),
      chart: barGeometry(
        period.dates.map((d) => {
          const s = days[d];
          return {
            date: d,
            kcal: s && s.count > 0 ? s.kcal : null,
            goal: s?.goal?.kcal_goal ?? null,
            zone: s?.status ?? null,
          };
        }),
        W,
        H,
        PAD,
      ),
    };
  }, [data, period, prev, today]);

  const step = (n: number) => setAnchor(shiftPeriod(period, n).from);
  const sel = selected && model ? model.days[selected] : undefined;

  const macroRows: { n: Nutrient; label: string; unit: string }[] = [
    { n: 'protein', label: t.home.protein, unit: t.home.g },
    { n: 'fat', label: t.home.fat, unit: t.home.g },
    { n: 'carbs', label: t.home.carbs, unit: t.home.g },
  ];

  return (
    <>
      <button type="button" className="back-link" onClick={onClose}>
        ‹ {t.stats.back}
      </button>
      <h1>{t.stats.title}</h1>

      <div className="segmented">
        <button type="button" className={kind === 'week' ? 'active' : ''} onClick={() => { setKind('week'); setAnchor(today); }}>
          {t.stats.week}
        </button>
        <button type="button" className={kind === 'month' ? 'active' : ''} onClick={() => { setKind('month'); setAnchor(today); }}>
          {t.stats.month}
        </button>
      </div>

      <section className="card">
        <div className="datebar">
          <button type="button" className="icon" aria-label={t.stats.prev} onClick={() => step(-1)}>
            ‹
          </button>
          <span className="datebar-title">{periodLabel(period)}</span>
          <button type="button" className="icon" aria-label={t.stats.next} disabled={isLatest} onClick={() => step(1)}>
            ›
          </button>
        </div>
      </section>

      {failed && (
        <div className="banner">
          <span>{t.stats.loadError}</span>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t.retry}
          </button>
        </div>
      )}
      {!model && !failed && (
        <div className="center-block">
          <div className="spinner" aria-label={t.loading} />
        </div>
      )}

      {model && (
        <>
          <section className="card">
            <h2>{t.stats.chartTitle}</h2>
            <svg className="bar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.stats.chartTitle}>
              <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" className="axis">{fmtKcal(model.chart.max)}</text>
              <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" className="axis">0</text>
              <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="axis-line" />
              {model.chart.bars.map((b, i) => {
                const d = period.dates[i];
                const future = d > today;
                const slot = (W - PAD.l - PAD.r) / period.dates.length;
                const showLabel = kind === 'week' || i === 0 || (i + 1) % 5 === 0 || i === period.dates.length - 1;
                const [, , dd] = d.split('-').map(Number);
                return (
                  <g key={d}>
                    {b.y !== null && (
                      <rect
                        x={b.x}
                        y={b.y}
                        width={b.width}
                        height={Math.max(b.height, 1)}
                        rx={Math.min(3, b.width / 2)}
                        className={`bar ${cls(b.zone)}${d === today ? ' bar-today' : ''}${selected === d ? ' bar-selected' : ''}`}
                      />
                    )}
                    {b.goalY !== null && !future && (
                      <line x1={b.x - 1} x2={b.x + b.width + 1} y1={b.goalY} y2={b.goalY} className="goal-tick" />
                    )}
                    {showLabel && (
                      <text x={b.x + b.width / 2} y={H - 8} textAnchor="middle" className="axis">
                        {kind === 'week' ? t.calendar.weekdays[i] : dd}
                      </text>
                    )}
                    {!future && (
                      <rect
                        x={PAD.l + slot * i}
                        y={PAD.t}
                        width={slot}
                        height={H - PAD.t - PAD.b}
                        className="bar-hit"
                        onClick={() => setSelected(d)}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
            <p className="muted small">{t.stats.chartHint}</p>
            {selected && (
              <div className="preview">
                <b>{localOf(selected).toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })}</b>
                <br />
                {sel && sel.count > 0 ? (
                  <>
                    <span className={cls(sel.status)}>
                      <b className="st-text">{fmtKcal(sel.kcal)}</b>
                    </span>
                    {sel.goal ? ` / ${fmtKcal(sel.goal.kcal_goal)}` : ''} {t.home.kcal} · {t.diary.p} {fmtG(sel.protein)} ·{' '}
                    {t.diary.f} {fmtG(sel.fat)} · {t.diary.c} {fmtG(sel.carbs)}
                    {selected === today && <span className="muted"> · {t.stats.inProgress}</span>}
                  </>
                ) : (
                  <span className="muted">{t.calendar.noEntries}</span>
                )}
              </div>
            )}
          </section>

          <section className="card">
            <h2>{t.stats.averages}</h2>
            {!model.cur.avg ? (
              <p className="muted">{t.stats.noData}</p>
            ) : (
              <>
                <div className={`avg-kcal ${cls(model.cur.zone.kcal)}`}>
                  <span className="big-num st-text">{fmtKcal(model.cur.avg.kcal)}</span>
                  <span className="muted"> {t.home.kcal} {t.stats.perDay}</span>
                  {model.cur.goal.kcal !== null && model.cur.pct.kcal !== null && (
                    <div className="st-text">
                      {model.cur.pct.kcal}% {t.stats.ofGoal} {fmtKcal(model.cur.goal.kcal)} {t.home.kcal}
                    </div>
                  )}
                </div>
                {macroRows.map(({ n, label, unit }) => (
                  <div className={`row ${cls(model.cur.zone[n])}`} key={n}>
                    <span className="muted">{label}</span>
                    <span>
                      <b>{fmtG(model.cur.avg![n])} {unit}</b>
                      {model.cur.goal[n] !== null && model.cur.pct[n] !== null && (
                        <span className="st-text"> · {model.cur.pct[n]}% {t.stats.of} {fmtG(model.cur.goal[n]!)}</span>
                      )}
                    </span>
                  </div>
                ))}
                <p className="muted small">
                  {t.stats.daysDone}: {model.cur.days} · {t.stats.zoneOk} {model.cur.zones.ok} · {t.stats.zoneLow} {model.cur.zones.low} · {t.stats.zoneHigh} {model.cur.zones.high}
                </p>
              </>
            )}
          </section>

          {model.cur.avg && model.share && (
            <section className="card">
              <h2>{t.stats.share}</h2>
              <div className="share-bar" role="img" aria-label={t.stats.share}>
                <i className="share-p" style={{ width: `${model.share.protein}%` }} />
                <i className="share-f" style={{ width: `${model.share.fat}%` }} />
                <i className="share-c" style={{ width: `${model.share.carbs}%` }} />
              </div>
              <div className="share-legend">
                <span><i className="share-p" /> {t.home.protein} {model.share.protein}%</span>
                <span><i className="share-f" /> {t.home.fat} {model.share.fat}%</span>
                <span><i className="share-c" /> {t.home.carbs} {model.share.carbs}%</span>
              </div>
              <p className="muted small">{t.stats.shareNote}</p>
            </section>
          )}

          {model.cur.avg && (
            <section className="card">
              <h2>{kind === 'week' ? t.stats.compareWeek : t.stats.compareMonth}</h2>
              {model.diff ? (
                <>
                  <div className="row">
                    <span className="muted">{t.home.kcal} {t.stats.perDay}</span>
                    <b>{signed(model.diff.kcal, fmtKcal)} {t.home.kcal}</b>
                  </div>
                  {macroRows.map(({ n, label, unit }) => (
                    <div className="row" key={n}>
                      <span className="muted">{label}</span>
                      <b>{signed(model.diff![n], fmtG)} {unit}</b>
                    </div>
                  ))}
                </>
              ) : (
                <p className="muted small">{t.stats.needTwo}</p>
              )}
            </section>
          )}

          <section className="card">
            <h2>{t.stats.top}</h2>
            {model.top.length === 0 ? (
              <p className="muted small">{t.stats.noTop}</p>
            ) : (
              model.top.map((p) => (
                <div className="row" key={p.name}>
                  <span className="entry-main">
                    <span className="entry-name">{p.name}</span>
                    <span className="muted small">
                      {p.days} {t.stats.topDays} · {fmtG(p.grams)} г
                    </span>
                  </span>
                  <b>{fmtKcal(p.kcal)} {t.home.kcal}</b>
                </div>
              ))
            )}
          </section>

          <p className="muted small">{t.stats.note}</p>
        </>
      )}
    </>
  );
}
